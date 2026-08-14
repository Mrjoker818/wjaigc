'use strict';

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name !== 'pptxgenjs' || pkg.version !== '4.0.1' || !pkg.dependencies?.['image-size']) {
        return pkg;
      }

      // The published bundle does not import image-size; removing the stale
      // edge avoids shipping its unpatched ICNS/JXL/HEIF parsers.
      const dependencies = { ...pkg.dependencies };
      delete dependencies['image-size'];
      return { ...pkg, dependencies };
    },
  },
};
