import { defaultFonts, type FontConfiguration } from '@gprose/view';

// Opt in for this book: ordinary samples retain the smaller default font set.
export const chineseFonts: FontConfiguration = {
  ...defaultFonts,
  fallbackFamilies: [...(defaultFonts.fallbackFamilies ?? []), 'Noto Sans CJK TC'],
  faces: [
    ...defaultFonts.faces,
    {
      family: 'Noto Sans CJK TC',
      weight: 400,
      style: 'normal',
      asset: 'fonts/NotoSansCJKtc-Regular.otf',
    },
    {
      family: 'Noto Sans CJK TC',
      weight: 700,
      style: 'normal',
      asset: 'fonts/NotoSansCJKtc-Bold.otf',
    },
  ],
};
