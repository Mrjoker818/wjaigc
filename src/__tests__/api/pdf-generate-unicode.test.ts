import { NextRequest } from 'next/server';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: vi.fn().mockResolvedValue({ user: { id: 'pdf-test-user' } }),
}));

import { POST } from '@/app/api/pdf/generate/route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://127.0.0.1/api/pdf/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function unicodeMaps(document: PDFDocument): string {
  return document.context.enumerateIndirectObjects().flatMap(([, object]) => {
    if (!(object instanceof PDFDict)) return [];
    const map = object.lookup(PDFName.of('ToUnicode'));
    return map instanceof PDFRawStream
      ? [new TextDecoder().decode(decodePDFRawStream(map).decode())]
      : [];
  }).join('\n');
}

describe('PDF generation with Chinese text', () => {
  it('creates searchable mixed-language Markdown and wraps long CJK text', async () => {
    const response = await POST(request({
      type: 'markdown',
      title: '验收',
      content: '# 项目验收 2026\n\n- 简体中文 Chinese\n> 內容確認\n\n' + '正常换行保留全部文字。'.repeat(320),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    const bytes = await response.arrayBuffer();
    expect(bytes.byteLength).toBeLessThan(100_000);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    const cmap = unicodeMaps(document);
    for (const code of ['9879', '9A8C', '6587', '78BA', '8A8D']) {
      expect(cmap).toContain('<' + code + '>');
    }
  });

  it('embeds a Chinese watermark in a real one-page PDF', async () => {
    const source = await PDFDocument.create();
    source.addPage();
    const bytes = Buffer.from(await source.save());
    const response = await POST(request({
      type: 'watermark', title: '验收', watermarkText: '仅供审核',
      pdfUrl: 'data:application/pdf;base64,' + bytes.toString('base64'),
    }));
    expect(response.status).toBe(200);
    const document = await PDFDocument.load(await response.arrayBuffer());
    expect(document.getPageCount()).toBe(1);
    const cmap = unicodeMaps(document);
    for (const code of ['4EC5', '4F9B', '5BA1', '6838']) {
      expect(cmap).toContain('<' + code + '>');
    }
  });

  it('fills a Chinese form field and embeds a readable appearance', async () => {
    const source = await PDFDocument.create();
    const form = source.getForm();
    form.createTextField('name').addToPage(source.addPage(), { width: 200, height: 24 });
    const bytes = Buffer.from(await source.save());
    const response = await POST(request({
      type: 'form', fields: { name: '张三' },
      pdfUrl: 'data:application/pdf;base64,' + bytes.toString('base64'),
    }));
    expect(response.status).toBe(200);
    const document = await PDFDocument.load(await response.arrayBuffer());
    expect(document.getForm().getTextField('name').getText()).toBe('张三');
    const cmap = unicodeMaps(document);
    expect(cmap).toContain('<5F20>');
    expect(cmap).toContain('<4E09>');
    const resources = document.getForm().acroForm.dict.lookup(PDFName.of('DR'), PDFDict);
    expect(resources.lookup(PDFName.of('Font'), PDFDict).get(PDFName.of('WujiePdfSansSC-Regular'))).toBeDefined();
  });

  it('rejects text outside the installed fonts without returning lossy PDF bytes', async () => {
    const response = await POST(request({ type: 'markdown', content: '中文档案 📌' }));
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('wraps a Chinese address in a multiline form without changing the stored value', async () => {
    const input = '广东省广州市海珠区滨江东路测试办公地址';
    const source = await PDFDocument.create();
    const address = source.getForm().createTextField('address');
    address.enableMultiline();
    address.addToPage(source.addPage(), { x: 40, y: 680, width: 100, height: 70 });
    address.setFontSize(12);
    const bytes = Buffer.from(await source.save());
    const response = await POST(request({
      type: 'form', fields: { address: input },
      pdfUrl: 'data:application/pdf;base64,' + bytes.toString('base64'),
    }));
    expect(response.status).toBe(200);
    const filled = await PDFDocument.load(await response.arrayBuffer());
    const field = filled.getForm().getTextField('address');
    expect(field.getText()).toBe(input);
    const appearance = filled.context.lookup(field.acroField.getWidgets()[0].getNormalAppearance());
    if (!(appearance instanceof PDFRawStream)) throw new Error('Expected a PDF field appearance stream');
    const operators = new TextDecoder().decode(decodePDFRawStream(appearance).decode());
    expect(operators.match(/ Tj$/gm)?.length).toBeGreaterThan(1);
  });

  it('skips oversized fields while preserving a valid Chinese field in the same form', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage();
    const form = source.getForm();
    const code = form.createTextField('code');
    code.setMaxLength(1);
    code.addToPage(page, { width: 100, height: 24 });
    form.createTextField('name').addToPage(page, { y: 90, width: 200, height: 24 });
    const bytes = Buffer.from(await source.save());
    const response = await POST(request({
      type: 'form', fields: { code: 'ABC', name: '张三' },
      pdfUrl: 'data:application/pdf;base64,' + bytes.toString('base64'),
    }));
    expect(response.status).toBe(200);
    const updated = (await PDFDocument.load(await response.arrayBuffer())).getForm();
    expect(updated.getTextField('code').getText()).toBeUndefined();
    expect(updated.getTextField('name').getText()).toBe('张三');
  });
});
