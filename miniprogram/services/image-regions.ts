export interface ImageRegion { field: string; label: string; x: number; y: number; width: number; height: number; }

export function fittedImageRegions(regions: readonly ImageRegion[], imageWidth: number, imageHeight: number, frameWidth: number, frameHeight: number) {
  if (![imageWidth,imageHeight,frameWidth,frameHeight].every(value => Number.isFinite(value) && value > 0)) return [];
  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  const width = imageWidth * scale / frameWidth, height = imageHeight * scale / frameHeight;
  const left = (1 - width) / 2, top = (1 - height) / 2;
  return regions.map(region => ({ ...region, style:`left:${(left + region.x * width) * 100}%;top:${(top + region.y * height) * 100}%;width:${region.width * width * 100}%;height:${region.height * height * 100}%` }));
}
