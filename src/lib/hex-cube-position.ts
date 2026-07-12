export interface HexCubeInitialPositionOptions {
  viewportWidth: number;
  viewportHeight: number;
  viewOffset: { x: number; y: number };
  zoom: number;
}

export function getHexCubeInitialPosition({
  viewportWidth, viewportHeight, viewOffset, zoom,
}: HexCubeInitialPositionOptions): { x: number; y: number } {
  return {
    x: (viewportWidth / 2 - 250 - viewOffset.x) / zoom,
    y: (viewportHeight / 2 - 200 - viewOffset.y) / zoom,
  };
}
