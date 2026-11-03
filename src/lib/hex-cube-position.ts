export interface HexCubeInitialPositionOptions {
  viewportWidth: number;
  viewportHeight: number;
  viewOffset: { x: number; y: number };
  zoom: number;
}

export function getHexCubeInitialPosition({
  viewportWidth, viewportHeight, viewOffset, zoom,
}: HexCubeInitialPositionOptions): { x: number; y: number } {
  const mobile = viewportWidth < 768;
  return {
    x: ((mobile ? 16 : viewportWidth / 2 - 250) - viewOffset.x) / zoom,
    y: ((mobile ? 16 : viewportHeight / 2 - 200) - viewOffset.y) / zoom,
  };
}
