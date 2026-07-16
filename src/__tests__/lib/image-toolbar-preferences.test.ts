import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER,
  normalizeImageToolbarPreferences,
} from '@/lib/image-toolbar-preferences';

describe('image toolbar preference migration', () => {
  it('restores new tools that a legacy order did not know about', () => {
    const legacyOrder = DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER.filter(
      label => label !== '美陈拆解' && label !== '人物精修大师'
    );

    const preferences = normalizeImageToolbarPreferences(
      legacyOrder,
      ['蒙版', '美陈拆解', '人物精修大师']
    );

    expect(preferences.order).toEqual(DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER);
    expect(preferences.hidden).toEqual(['蒙版']);
  });

  it('keeps explicit hides for tools that existed in the saved order', () => {
    const preferences = normalizeImageToolbarPreferences(
      DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER,
      ['蒙版', '人物精修大师']
    );

    expect(preferences.hidden).toEqual(['蒙版', '人物精修大师']);
  });
});
