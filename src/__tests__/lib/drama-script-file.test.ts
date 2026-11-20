import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readScriptFile, SCRIPT_FILE_LIMITS } from '@/lib/drama/script-file';

async function docx(text = 'ALICE: Hello') {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
const upload = (data: Uint8Array, name = 'script.docx') => new File([new Uint8Array(data)], name);

describe('source file loading', () => {
  it('decodes strict UTF8 TXT preserving BOM and CRLF and extracts DOCX through mammoth', async () => {
    expect(await readScriptFile(upload(Buffer.from('\uFEFF甲：😀\r\n'), '稿件.TXT'))).toEqual({ text: '\uFEFF甲：😀\r\n', fileName: '稿件.TXT', format: 'txt', warnings: [] });
    const result = await readScriptFile(upload(await docx()));
    expect(result.text).toBe('ALICE: Hello\n\n'); expect(result.format).toBe('docx');
  });
  it('rejects invalid encoding, unsupported files and large uploads before reading', async () => {
    await expect(readScriptFile(upload(new Uint8Array([0xff, 0xfe]), 'bad.txt'))).rejects.toThrow();
    await expect(readScriptFile(upload(Buffer.from('hello'), 'script.pdf'))).rejects.toThrow();
    const arrayBuffer = () => { throw new Error('MUST_NOT_READ'); };
    await expect(readScriptFile({ name: 'big.docx', size: SCRIPT_FILE_LIMITS.uploadBytes + 1, arrayBuffer })).rejects.toThrow(/LIMIT/);
  });
  it.each(['encrypted', 'zip64', 'unpacked', 'entries', 'local-encrypted', 'bad-offset'])(
    'rejects hostile ZIP metadata before decompression: %s', async kind => {
      const bytes = await docx(); const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (kind === 'encrypted') { bytes.writeUInt16LE(1, central + 8); bytes.writeUInt16LE(1, 6); }
      if (kind === 'local-encrypted') bytes.writeUInt16LE(1, 6);
      if (kind === 'zip64') bytes.writeUInt32LE(0xffffffff, central + 24);
      if (kind === 'unpacked') bytes.writeUInt32LE(SCRIPT_FILE_LIMITS.entryBytes + 1, central + 24);
      if (kind === 'entries') { bytes.writeUInt16LE(SCRIPT_FILE_LIMITS.entries + 1, end + 8); bytes.writeUInt16LE(SCRIPT_FILE_LIMITS.entries + 1, end + 10); }
      if (kind === 'bad-offset') bytes.writeUInt32LE(0xffffff00, central + 42);
      const expected = kind === 'encrypted' || kind === 'local-encrypted' ? /ENCRYPTED/
        : kind === 'zip64' ? /ZIP64/ : kind === 'entries' ? /ENTRY_LIMIT/ : kind === 'unpacked' ? /UNPACKED_LIMIT/ : /ZIP_INVALID/;
      await expect(readScriptFile(upload(bytes))).rejects.toThrow(expected);
    },
  );
  it('rejects aggregate unpacked size and plain ZIPs disguised as DOCX', async () => {
    const zip = new JSZip(); zip.file('text.txt', 'x');
    await expect(readScriptFile(upload(await zip.generateAsync({ type: 'nodebuffer' })))).rejects.toThrow();
    zip.file('[Content_Types].xml', 'x'); zip.file('word/document.xml', 'x'); zip.file('a.xml', 'x'); zip.file('b.xml', 'x');
    const bytes = await zip.generateAsync({ type: 'nodebuffer' }); let offset = 0;
    while ((offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) >= 0) {
      bytes.writeUInt32LE(SCRIPT_FILE_LIMITS.entryBytes, offset + 24);
      bytes.writeUInt32LE(SCRIPT_FILE_LIMITS.entryBytes, bytes.readUInt32LE(offset + 42) + 22); offset += 46;
    }
    await expect(readScriptFile(upload(bytes))).rejects.toThrow(/UNPACKED_LIMIT/);
  });
  it('caps actual inflation even when both headers lie about the unpacked size', async () => {
    const zip = new JSZip(); zip.file('word/document.xml', 'x'.repeat(SCRIPT_FILE_LIMITS.entryBytes + 1));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    let offset = 0;
    while ((offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) >= 0) {
      const local = bytes.readUInt32LE(offset + 42); bytes.writeUInt32LE(0, offset + 24); bytes.writeUInt32LE(0, local + 22); offset += 46;
    }
    await expect(readScriptFile(upload(bytes))).rejects.toThrow(/UNPACKED_LIMIT/);
  });
});
