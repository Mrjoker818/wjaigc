declare module 'imagetracerjs' {
  interface ImageTracerOptions {
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    colorsampling?: number;
    numberofcolors?: number;
    mincolorratio?: number;
    colorquantcycles?: number;
    blurradius?: number;
    blurdelta?: number;
    scale?: number;
    roundcoords?: number;
    desc?: boolean;
    viewbox?: boolean;
    strokewidth?: number;
    linefilter?: boolean;
    palette?: Array<[number, number, number]>;
    layering?: number;
    [key: string]: unknown;
  }

  const ImageTracer: {
    imageToSVG: typeof imageToSVG;
    imagedataToSVG: (imagedata: ImageData, options?: ImageTracerOptions) => string;
    optionpresets: Record<string, ImageTracerOptions>;
  };

  export default ImageTracer;
  export { ImageTracer, ImageTracerOptions };
}
