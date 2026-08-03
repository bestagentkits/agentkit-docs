export const docsOgLayout = Object.freeze({
  contentHeight: 390,
  titleMaxHeight: 174,
  footerHeight: 56,
});

function textLength(value) {
  return Array.from(value.trim()).length;
}

export function getDocsOgTypography(title, description = '') {
  const titleLength = textLength(title);
  const descriptionLength = textLength(description);

  return {
    titleFontSize: titleLength <= 35 ? 70 : titleLength <= 65 ? 62 : 54,
    descriptionFontSize:
      descriptionLength <= 100 ? 36 : descriptionLength <= 180 ? 32 : 28,
  };
}
