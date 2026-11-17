import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');

describe('/api/generate synchronous charge refund', () => {
  it('refunds the synchronous charge once, with a reference id, when submission fails', () => {
    const charge = source.indexOf("consumeCredits(sessionUser.id, 'image_generate', undefined, undefined, modelId");
    expect(charge).toBeGreaterThan(0);
    expect(source).toContain('refundCredits(chargedUserId, chargedCredits, \'图像生成提交失败退款\', refundReference)');
    const allFailed = source.indexOf('所有可用模型均提交失败，请稍后重试或联系管理员配置');
    expect(source.lastIndexOf('await refundSyncCharge?.();', allFailed)).toBeGreaterThan(charge);
    expect(source.indexOf('syncChargeHandedOff = true;')).toBeGreaterThan(allFailed);
    expect(source).toMatch(/catch \(apiError: unknown\) \{\s*await refundSyncCharge\?\.\(\);/);
  });

  it('records submitOnly credits as refunded only after the refund succeeds', () => {
    expect(source).not.toContain("creditStatus: deductedCredits > 0 ? 'refunded' : 'not-applicable'");
    const helper = source.slice(source.indexOf('const failSubmitOnly = async ('));
    expect(helper.indexOf('refundCredits(sessionUser.id, deductedCredits, refundReason, asyncTaskId)'))
      .toBeLessThan(helper.indexOf('recordSubmitOnlyTerminal({ ...input, creditStatus })'));
    expect(helper).toContain("if (refund.success) creditStatus = 'refunded';");
  });
});
