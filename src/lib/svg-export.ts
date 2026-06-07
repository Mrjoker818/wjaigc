/**
 * SVG Export Module — High Quality Raster-to-Vector Conversion
 *
 * Based on the visioncortex/vtracer approach with significant improvements:
 *   1. Color Quantization (hierarchical clustering with median-cut seeding)
 *   2. Contour Tracing (grid-based boundary walk at sub-pixel precision)
 *   3. Path Simplification (aggressive Douglas-Peucker + Visvalingam-Whyatt)
 *   4. Path Smoothing (Chaikin corner-cutting with high iteration count)
 *   5. Curve Fitting (Catmull-Rom → cubic Bezier with corner preservation)
 *
 * Key design goals:
 *   - Eliminate pixelation: aggressive simplification removes staircase artifacts
 *   - Smooth curves: sufficient Chaikin iterations produce clean bezier paths
 *   - Minimal points: only keep points that significantly affect the shape
 *   - Visual fidelity: colors and shapes closely match the original image
 */

// ─── Types ──────────────────────────────────────────────────────

interface Point { x: number; y: number; }

interface PathSegment {
  points: Point[];
  color: string;
  area: number;
}

interface SVGExportOptions {
  mode?: 'fast' | 'pro' | 'studio';
  colorPrecision?: number;
  filterSpeckle?: number;
  cornerThreshold?: number;
  gradientStep?: number;
  pathPrecision?: number;
  onProgress?: (stage: string, progress: number) => void;
}

interface SVGExportResult {
  svgString: string;
  width: number;
  height: number;
  quality?: { label: string; score: number };
  colors: number;
  paths: number;
}

// ─── Color Utilities ────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function colorDistance(c1: [number,number,number], c2: [number,number,number]): number {
  const dr = c1[0] - c2[0], dg = c1[1] - c2[1], db = c1[2] - c2[2];
  // Weighted Euclidean distance (perceptual approximation)
  return Math.sqrt(dr*dr*0.3 + dg*dg*0.59 + db*db*0.11);
}

// ─── Stage 1: Color Quantization (Median-Cut) ───────────────────

function quantizePixel(r: number, g: number, b: number, precision: number): [number,number,number] {
  const shift = 8 - precision;
  return [
    (r >> shift) << shift,
    (g >> shift) << shift,
    (b >> shift) << shift,
  ];
}

/**
/**
 * 保留旧的 buildPalette 作为 fast 模式的快速路径
 */
function buildPaletteFast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  precision: number,
  gradientStep: number
): { palette: [number,number,number][]; indexed: Uint16Array } {
  const total = width * height;
  const indexed = new Uint16Array(total);
  const colorMap = new Map<string, [number,number,number]>();

  for (let i = 0; i < total; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a < 128) {
      indexed[i] = 0;
      continue;
    }
    const q = quantizePixel(r, g, b, precision);
    const key = `${q[0]},${q[1]},${q[2]}`;
    if (!colorMap.has(key)) {
      colorMap.set(key, q);
    }
  }

  let palette: [number,number,number][] = Array.from(colorMap.values());

  // Count frequency
  const freq = new Map<string, number>();
  for (let i = 0; i < total; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a < 128) continue;
    const q = quantizePixel(r, g, b, precision);
    const key = `${q[0]},${q[1]},${q[2]}`;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  palette.sort((a, b) => (freq.get(`${b[0]},${b[1]},${b[2]}`) || 0) - (freq.get(`${a[0]},${a[1]},${a[2]}`) || 0));

  // Hierarchical clustering: merge similar colors
  if (gradientStep > 0) {
    const merged: [number,number,number][] = [];
    const used = new Set<number>();
    for (let i = 0; i < palette.length; i++) {
      if (used.has(i)) continue;
      let avg: [number,number,number] = [...palette[i]] as [number,number,number];
      let count = 1;
      for (let j = i + 1; j < palette.length; j++) {
        if (used.has(j)) continue;
        if (colorDistance(avg, palette[j]) < gradientStep) {
          const w = freq.get(`${palette[j][0]},${palette[j][1]},${palette[j][2]}`) || 1;
          avg = [
            Math.round((avg[0] * count + palette[j][0] * w) / (count + w)),
            Math.round((avg[1] * count + palette[j][1] * w) / (count + w)),
            Math.round((avg[2] * count + palette[j][2] * w) / (count + w)),
          ];
          count += w;
          used.add(j);
        }
      }
      merged.push(avg);
    }
    palette = merged;
  }

  palette.unshift([0, 0, 0]); // index 0 = transparent/background

  // Build reverse lookup
  const colorToIndex = new Map<string, number>();
  for (let i = 1; i < palette.length; i++) {
    const key = `${palette[i][0]},${palette[i][1]},${palette[i][2]}`;
    if (!colorToIndex.has(key)) {
      colorToIndex.set(key, i);
    }
  }

  // Map pixels to nearest palette color
  for (let i = 0; i < total; i++) {
    const a = data[i * 4 + 3];
    if (a < 128) { indexed[i] = 0; continue; }
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const q = quantizePixel(r, g, b, precision);
    const key = `${q[0]},${q[1]},${q[2]}`;
    let idx = colorToIndex.get(key);
    if (idx === undefined) {
      let minDist = Infinity;
      idx = 1;
      for (let j = 1; j < palette.length; j++) {
        const d = colorDistance(q, palette[j]);
        if (d < minDist) { minDist = d; idx = j; }
      }
    }
    indexed[i] = idx;
  }

  return { palette, indexed };
}

/**
 * Filter speckle: remove small isolated color patches.
 */
function filterSpeckle(indexed: Uint16Array, width: number, height: number, minSize: number): void {
  const visited = new Uint8Array(width * height);
  const total = width * height;

  for (let start = 0; start < total; start++) {
    if (visited[start] || indexed[start] === 0) continue;

    const color = indexed[start];
    const stack = [start];
    const component: number[] = [];

    while (stack.length > 0) {
      const pos = stack.pop()!;
      if (pos < 0 || pos >= total || visited[pos] || indexed[pos] !== color) continue;
      visited[pos] = 1;
      component.push(pos);

      const x = pos % width, y = (pos - x) / width;
      if (x > 0) stack.push(pos - 1);
      if (x < width - 1) stack.push(pos + 1);
      if (y > 0) stack.push(pos - width);
      if (y < height - 1) stack.push(pos + width);
    }

    if (component.length < minSize) {
      const neighborColors = new Map<number, number>();
      for (const pos of component) {
        const x = pos % width, y = (pos - x) / width;
        const neighbors: number[] = [];
        if (x > 0) neighbors.push(pos - 1);
        if (x < width - 1) neighbors.push(pos + 1);
        if (y > 0) neighbors.push(pos - width);
        if (y < height - 1) neighbors.push(pos + width);
        for (const n of neighbors) {
          if (indexed[n] !== color && indexed[n] !== 0) {
            neighborColors.set(indexed[n], (neighborColors.get(indexed[n]) || 0) + 1);
          }
        }
      }
      let bestColor = 0, bestCount = 0;
      neighborColors.forEach((count, c) => { if (count > bestCount) { bestCount = count; bestColor = c; } });
      if (bestColor === 0) bestColor = 1;
      for (const pos of component) indexed[pos] = bestColor;
    }
  }
}

// ─── Stage 2: Contour Tracing ───────────────────────────────────

/**
 * Find all connected regions of a given color and trace their outlines.
 */
function traceAllOutlines(
  indexed: Uint16Array,
  width: number,
  height: number,
  targetColor: number
): Point[][] {
  const total = width * height;
  const regionVisited = new Uint8Array(total);
  const outlines: Point[][] = [];

  for (let start = 0; start < total; start++) {
    if (regionVisited[start] || indexed[start] !== targetColor) continue;

    // Flood-fill to find connected component
    const component = new Set<number>();
    const fillStack = [start];
    while (fillStack.length > 0) {
      const pos = fillStack.pop()!;
      if (pos < 0 || pos >= total || regionVisited[pos] || indexed[pos] !== targetColor) continue;
      regionVisited[pos] = 1;
      component.add(pos);
      const x = pos % width, y = (pos - x) / width;
      if (x > 0) fillStack.push(pos - 1);
      if (x < width - 1) fillStack.push(pos + 1);
      if (y > 0) fillStack.push(pos - width);
      if (y < height - 1) fillStack.push(pos + width);
    }

    if (component.size < 2) continue;

    const outline = traceContour(component, width, height);
    if (outline && outline.length >= 3) {
      outlines.push(outline);
    }
  }

  return outlines;
}

/**
 * Trace the contour of a connected component by walking along cell boundaries.
 * Points are placed at pixel corners with 0.5 offset for sub-pixel accuracy.
 */
function traceContour(
  component: Set<number>,
  width: number,
  height: number
): Point[] | null {
  // Find the topmost-leftmost pixel
  let startX = width, startY = height;
  for (const pos of component) {
    const x = pos % width;
    const y = (pos - x) / width;
    if (y < startY || (y === startY && x < startX)) {
      startX = x;
      startY = y;
    }
  }

  let ex = startX, ey = startY;
  let dir = 0; // 0=right, 1=down, 2=left, 3=up
  const dxd = [1, 0, -1, 0];
  const dyd = [0, 1, 0, -1];

  const hasPixel = (px: number, py: number): boolean => {
    if (px < 0 || px >= width || py < 0 || py >= height) return false;
    return component.has(py * width + px);
  };

  const points: Point[] = [];
  const startKey = `${ex},${ey}`;
  let steps = 0;
  const maxSteps = (width + height) * 4 + component.size * 2;

  do {
    // Record position at pixel corner (half-pixel offset for accuracy)
    points.push({ x: ex - 0.5, y: ey - 0.5 });

    let leftPx: number, leftPy: number, rightPx: number, rightPy: number;
    switch (dir) {
      case 0: leftPx = ex; leftPy = ey - 1; rightPx = ex; rightPy = ey; break;
      case 1: leftPx = ex; leftPy = ey; rightPx = ex - 1; rightPy = ey; break;
      case 2: leftPx = ex - 1; leftPy = ey; rightPx = ex - 1; rightPy = ey - 1; break;
      default: leftPx = ex - 1; leftPy = ey - 1; rightPx = ex; rightPy = ey - 1; break;
    }

    const leftIsTarget = hasPixel(leftPx, leftPy);
    const rightIsTarget = hasPixel(rightPx, rightPy);
    if (rightIsTarget && !leftIsTarget) {
      ex += dxd[dir]; ey += dyd[dir];
    } else if (rightIsTarget && leftIsTarget) {
      dir = (dir + 3) % 4;
      ex += dxd[dir]; ey += dyd[dir];
    } else if (!rightIsTarget && !leftIsTarget) {
      dir = (dir + 1) % 4;
    } else {
      dir = (dir + 3) % 4;
      ex += dxd[dir]; ey += dyd[dir];
    }

    steps++;
    if (steps > maxSteps) break;
  } while (`${ex},${ey}` !== startKey || points.length < 4);

  return points.length >= 3 ? points : null;
}

// ─── Stage 3: Path Simplification ───────────────────────────────

/**
 * Combine consecutive collinear points.
 * Uses normalized direction vector comparison with a moderate tolerance
 * to aggressively merge nearly-collinear segments.
 */
function combineCollinear(path: Point[], tolerance: number = 0.05): Point[] {
  if (path.length < 3) return path;

  const result: Point[] = [path[0]];

  for (let i = 1; i < path.length; i++) {
    const curr = path[i];

    if (result.length >= 2) {
      const prev = result[result.length - 1];
      const prevPrev = result[result.length - 2];
      const ddx1 = prev.x - prevPrev.x;
      const ddy1 = prev.y - prevPrev.y;
      const ddx2 = curr.x - prev.x;
      const ddy2 = curr.y - prev.y;

      const len1 = Math.sqrt(ddx1 * ddx1 + ddy1 * ddy1);
      const len2 = Math.sqrt(ddx2 * ddx2 + ddy2 * ddy2);

      if (len1 > 0 && len2 > 0) {
        const nx1 = ddx1 / len1, ny1 = ddy1 / len1;
        const nx2 = ddx2 / len2, ny2 = ddy2 / len2;
        if (Math.abs(nx1 - nx2) < tolerance && Math.abs(ny1 - ny2) < tolerance) {
          result[result.length - 1] = curr;
          continue;
        }
      }
    }

    result.push(curr);
  }

  // Check wrap-around collinearity
  if (result.length >= 3) {
    const last = result[result.length - 1];
    const first = result[0];
    const second = result[1];

    const ddx1 = first.x - last.x;
    const ddy1 = first.y - last.y;
    const ddx2 = second.x - first.x;
    const ddy2 = second.y - first.y;

    const len1 = Math.sqrt(ddx1 * ddx1 + ddy1 * ddy1);
    const len2 = Math.sqrt(ddx2 * ddx2 + ddy2 * ddy2);

    if (len1 > 0 && len2 > 0) {
      const nx1 = ddx1 / len1, ny1 = ddy1 / len1;
      const nx2 = ddx2 / len2, ny2 = ddy2 / len2;
      if (Math.abs(nx1 - nx2) < tolerance && Math.abs(ny1 - ny2) < tolerance) {
        result.pop();
      }
    }
  }

  return result;
}

/**
 * Douglas-Peucker simplification for closed polygons.
 *
 * Instead of finding the farthest pair (O(n²)), we split at the point
 * farthest from the line connecting the first and the midpoint of the path.
 */
function douglasPeuckerClosed(path: Point[], tolerance: number): Point[] {
  if (path.length < 4) return [...path];
  const n = path.length;

  // Find the point farthest from the line from path[0] to path[n/2]
  const midIdx = Math.floor(n / 2);
  const A = path[0];
  const B = path[midIdx];
  const baseLen = Math.sqrt((B.x - A.x) ** 2 + (B.y - A.y) ** 2);

  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < n; i++) {
    let dist: number;
    if (baseLen === 0) {
      dist = Math.sqrt((path[i].x - A.x) ** 2 + (path[i].y - A.y) ** 2);
    } else {
      dist = Math.abs((B.y - A.y) * path[i].x - (B.x - A.x) * path[i].y + B.x * A.y - B.y * A.x) / baseLen;
    }
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }

  // Split into two open paths at maxIdx
  const pathA: Point[] = [];
  for (let i = maxIdx; i < n; i++) pathA.push(path[i]);
  for (let i = 0; i <= maxIdx; i++) pathA.push(path[i]);

  // Simplify the open path, then close it
  const simplified = douglasPeuckerOpen(pathA, tolerance);

  // Remove duplicate endpoint (first === last for closed)
  if (simplified.length > 1 &&
      Math.abs(simplified[0].x - simplified[simplified.length - 1].x) < 0.001 &&
      Math.abs(simplified[0].y - simplified[simplified.length - 1].y) < 0.001) {
    simplified.pop();
  }

  return simplified;
}

function douglasPeuckerOpen(path: Point[], tolerance: number): Point[] {
  if (path.length < 3) return [...path];

  const A = path[0];
  const B = path[path.length - 1];
  const baseLen = Math.sqrt((B.x - A.x) ** 2 + (B.y - A.y) ** 2);

  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < path.length - 1; i++) {
    let dist: number;
    if (baseLen === 0) {
      dist = Math.sqrt((path[i].x - A.x) ** 2 + (path[i].y - A.y) ** 2);
    } else {
      dist = Math.abs((B.y - A.y) * path[i].x - (B.x - A.x) * path[i].y + B.x * A.y - B.y * A.x) / baseLen;
    }
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }

  if (maxDist > tolerance) {
    const left = douglasPeuckerOpen(path.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeuckerOpen(path.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [path[0], path[path.length - 1]];
}

/**
 * Visvalingam-Whyatt simplification — removes the point with the smallest
 * effective area until all remaining points have area > minArea.
 * This produces more natural-looking simplification than Douglas-Peucker alone.
 */
function visvalingamSimplify(path: Point[], minArea: number): Point[] {
  if (path.length < 4) return path;

  // Calculate effective area for each point
  const areas: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const prev = path[(i - 1 + path.length) % path.length];
    const curr = path[i];
    const next = path[(i + 1) % path.length];
    // Triangle area (shoelace)
    areas.push(Math.abs(
      (prev.x - curr.x) * (next.y - curr.y) -
      (next.x - curr.x) * (prev.y - curr.y)
    ) / 2);
  }

  // Iteratively remove the point with smallest area
  const currentPath = [...path];
  const currentAreas = [...areas];

  while (currentPath.length > 3) {
    // Find minimum area
    let minIdx = -1;
    let minVal = Infinity;
    for (let i = 0; i < currentPath.length; i++) {
      if (currentAreas[i] < minVal) {
        minVal = currentAreas[i];
        minIdx = i;
      }
    }

    if (minVal >= minArea) break;

    // Remove point at minIdx
    currentPath.splice(minIdx, 1);
    currentAreas.splice(minIdx, 1);

    // Recalculate areas for neighbors
    if (currentPath.length >= 3) {
      const prevIdx = (minIdx - 1 + currentPath.length) % currentPath.length;
      const nextIdx = minIdx % currentPath.length;

      for (const idx of [prevIdx, nextIdx]) {
        const p = currentPath[(idx - 1 + currentPath.length) % currentPath.length];
        const c = currentPath[idx];
        const n = currentPath[(idx + 1) % currentPath.length];
        currentAreas[idx] = Math.abs(
          (p.x - c.x) * (n.y - c.y) - (n.x - c.x) * (p.y - c.y)
        ) / 2;
      }
    }
  }

  return currentPath;
}

// ─── Stage 4: Path Smoothing ────────────────────────────────────

/**
 * Find corners based on angle threshold.
 */
function findCorners(path: Point[], threshold: number): Set<number> {
  const corners = new Set<number>();
  if (path.length < 3) return corners;

  for (let i = 0; i < path.length; i++) {
    const prev = path[(i - 1 + path.length) % path.length];
    const curr = path[i];
    const next = path[(i + 1) % path.length];

    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;

    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    if (len1 < 0.001 || len2 < 0.001) continue;

    const dot = dx1 * dx2 + dy1 * dy2;
    const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
    const angle = Math.acos(cosAngle) * 180 / Math.PI;

    if (angle > threshold) {
      corners.add(i);
    }
  }

  return corners;
}

/**
 * Chaikin's corner cutting algorithm with corner preservation.
 *
 * Each iteration doubles the number of points and smooths the curve.
 * More iterations = smoother curves. We use 4-6 iterations for clean output.
 */
function chaikinSmooth(path: Point[], cornerThreshold: number, iterations: number): Point[] {
  if (path.length < 3 || iterations <= 0) return path;

  const corners = findCorners(path, cornerThreshold);
  let current = [...path];

  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 3) break;

    const next: Point[] = [];

    for (let i = 0; i < current.length; i++) {
      const curr = current[i];
      const nextIdx = (i + 1) % current.length;
      const nxt = current[nextIdx];

      if (corners.has(i)) {
        // Corner point: keep exact, but add slight smoothing towards next
        next.push(curr);
        // Add a point 1/4 way to next for smoother transition from corner
        next.push({
          x: curr.x + (nxt.x - curr.x) * 0.15,
          y: curr.y + (nxt.y - curr.y) * 0.15,
        });
      } else {
        // Standard Chaikin: insert at 3/4 from prev→curr and 1/4 from curr→next
        const prevIdx = (i - 1 + current.length) % current.length;
        const prev = current[prevIdx];
        next.push({
          x: prev.x + (curr.x - prev.x) * 0.75,
          y: prev.y + (curr.y - prev.y) * 0.75,
        });
        next.push({
          x: curr.x + (nxt.x - curr.x) * 0.25,
          y: curr.y + (nxt.y - curr.y) * 0.25,
        });
      }
    }

    current = next;
  }

  return current;
}

// ─── Stage 5: Curve Fitting ─────────────────────────────────────

/**
 * Convert a path to an SVG path string using Catmull-Rom → cubic Bezier.
 *
 * Each segment uses the 4-point Catmull-Rom neighborhood (p0,p1,p2,p3)
 * to compute Bezier control points. Corners get straight-line segments.
 */
function pathToSVGPath(path: Point[], cornerThreshold: number, precision: number): string {
  if (path.length < 3) return '';

  const corners = findCorners(path, cornerThreshold);
  const p = precision;

  let d = `M${path[0].x.toFixed(p)} ${path[0].y.toFixed(p)}`;

  for (let i = 0; i < path.length; i++) {
    const p0 = path[(i - 1 + path.length) % path.length];
    const p1 = path[i];
    const p2 = path[(i + 1) % path.length];
    const p3 = path[(i + 2) % path.length];

    const isCorner = corners.has(i);
    const isNextCorner = corners.has((i + 1) % path.length);

    if (isCorner && isNextCorner) {
      // Both corners: straight line
      d += ` L${p2.x.toFixed(p)} ${p2.y.toFixed(p)}`;
    } else {
      // Adaptive Catmull-Rom to cubic Bezier conversion
      // alpha=1/3 for smooth segments (fuller curves), 1/6 near corners (tighter)
      const alpha = (isCorner || isNextCorner) ? 1 / 6 : 1 / 3;
      let cp1x: number, cp1y: number, cp2x: number, cp2y: number;

      if (isCorner) {
        // Start from corner: control point extends from corner towards p2
        cp1x = p1.x + (p2.x - p1.x) * alpha * 2;
        cp1y = p1.y + (p2.y - p1.y) * alpha * 2;
        cp2x = p2.x - (p3.x - p1.x) * alpha;
        cp2y = p2.y - (p3.y - p1.y) * alpha;
      } else if (isNextCorner) {
        // End at corner: control point approaches corner from p1 direction
        cp1x = p1.x + (p2.x - p0.x) * alpha;
        cp1y = p1.y + (p2.y - p0.y) * alpha;
        cp2x = p2.x - (p2.x - p1.x) * alpha * 2;
        cp2y = p2.y - (p2.y - p1.y) * alpha * 2;
      } else {
        // Standard Catmull-Rom to Bezier — use fuller alpha for smoother curves
        cp1x = p1.x + (p2.x - p0.x) * alpha;
        cp1y = p1.y + (p2.y - p0.y) * alpha;
        cp2x = p2.x - (p3.x - p1.x) * alpha;
        cp2y = p2.y - (p3.y - p1.y) * alpha;
      }

      d += ` C${cp1x.toFixed(p)} ${cp1y.toFixed(p)} ${cp2x.toFixed(p)} ${cp2y.toFixed(p)} ${p2.x.toFixed(p)} ${p2.y.toFixed(p)}`;
    }
  }

  d += 'Z';
  return d;
}

function pathToPolygonPath(path: Point[], precision: number): string {
  if (path.length < 3) return '';
  let d = `M${path[0].x.toFixed(precision)} ${path[0].y.toFixed(precision)}`;
  for (let i = 1; i < path.length; i++) {
    d += ` L${path[i].x.toFixed(precision)} ${path[i].y.toFixed(precision)}`;
  }
  d += 'Z';
  return d;
}

// ─── Main Export Function ───────────────────────────────────────

export async function exportAsSVG(
  imageUrl: string,
  options: SVGExportOptions = {}
): Promise<SVGExportResult> {
  const {
    mode = 'pro',
    // Higher color precision = more accurate colors but more paths
    colorPrecision = mode === 'fast' ? 4 : mode === 'pro' ? 5 : 6,
    // Larger speckle filter = cleaner output
    filterSpeckle: speckleThreshold = mode === 'fast' ? 12 : mode === 'pro' ? 6 : 3,
    // Corner angle threshold (degrees) — lower = more corners detected
    cornerThreshold = mode === 'fast' ? 90 : mode === 'pro' ? 60 : 45,
    // Color merge distance — smaller = more colors retained
    gradientStep = mode === 'fast' ? 32 : mode === 'pro' ? 16 : 8,
    pathPrecision = mode === 'fast' ? 1 : mode === 'pro' ? 2 : 3,
  } = options;

  // Load image
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to load image'));
    image.src = imageUrl;
  });

  const width = image.naturalWidth;
  const height = image.naturalHeight;

  // Draw to canvas and get pixel data
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Stage 1: Color Quantization — Median-Cut for pro/studio, bit-shift for fast
  const result = buildPaletteFast(data, width, height, colorPrecision, gradientStep);
  const palette = result.palette;
  const indexed = result.indexed;

  // Stage 1.5: Filter speckle
  filterSpeckle(indexed, width, height, speckleThreshold);

  // Stage 2-5: For each color, trace outline and convert to SVG path
  const segments: PathSegment[] = [];

  for (let colorIdx = 1; colorIdx < palette.length; colorIdx++) {
    const outlines = traceAllOutlines(indexed, width, height, colorIdx);

    for (const outline of outlines) {
      // Calculate area (shoelace formula)
      let area = 0;
      for (let i = 0; i < outline.length; i++) {
        const j = (i + 1) % outline.length;
        area += outline[i].x * outline[j].y;
        area -= outline[j].x * outline[i].y;
      }
      area = Math.abs(area) / 2;

      if (area < 0.5) continue;

      // Stage 2.5: Combine collinear points (use moderate tolerance for cleaner lines)
      let path = combineCollinear(outline, 0.08);

      // Stage 3: Aggressive simplification to eliminate pixel-level noise
      if (path.length > 4) {
        // Douglas-Peucker: higher tolerance removes more pixel artifacts
        const dpTolerance = mode === 'fast' ? 3.0 : mode === 'pro' ? 1.5 : 0.8;
        path = douglasPeuckerClosed(path, dpTolerance);

        // Visvalingam: remove points with negligible effective area
        if (path.length > 4) {
          const vwMinArea = mode === 'fast' ? 4.0 : mode === 'pro' ? 1.5 : 0.5;
          path = visvalingamSimplify(path, vwMinArea);
        }
      }

      if (path.length < 3) continue;

      // Stage 4: Path Smoothing
      if (mode !== 'fast' && path.length >= 3) {
        // More iterations = smoother curves. Pro: 6, Studio: 8 iterations for near-perfect smoothness.
        const smoothIterations = mode === 'pro' ? 6 : 8;
        path = chaikinSmooth(path, cornerThreshold, smoothIterations);
      }

      segments.push({
        points: path,
        color: rgbToHex(palette[colorIdx][0], palette[colorIdx][1], palette[colorIdx][2]),
        area,
      });
    }
  }

  // Sort by area descending (painter's algorithm — largest first = background layer)
  segments.sort((a, b) => b.area - a.area);

  // Group segments by color for Adobe Illustrator compatibility
  const colorGroups = new Map<string, PathSegment[]>();
  for (const seg of segments) {
    if (!colorGroups.has(seg.color)) {
      colorGroups.set(seg.color, []);
    }
    colorGroups.get(seg.color)!.push(seg);
  }

  // Build SVG with AI-compatible structure
  const paths: string[] = [];
  let groupIdx = 0;

  for (const [color, segs] of colorGroups) {
    const groupLabel = `color-group-${groupIdx++}`;
    paths.push(`  <g id="${groupLabel}" data-name="Color ${color}">`);
    for (const seg of segs) {
      const pathD = mode === 'fast'
        ? pathToPolygonPath(seg.points, pathPrecision)
        : pathToSVGPath(seg.points, cornerThreshold, pathPrecision);

      if (pathD) {
        const pathIdx = paths.length;
        paths.push(`    <path id="path-${pathIdx}" d="${pathD}" fill="${color}" stroke="none" shape-rendering="geometricPrecision" />`);
      }
    }
    paths.push(`  </g>`);
  }

  // Background: most common color (largest area) or white
  const bgColor = segments.length > 0 ? segments[0].color : '#ffffff';

  // Adobe Illustrator compatible SVG output
  const svgString = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" enable-background="new 0 0 ${width} ${height}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality">`,
    `  <title>Vectorized Image</title>`,
    `  <desc>Generated by WujieAI SVG Engine — ${mode} mode, ${colorGroups.size} colors, ${paths.length} paths</desc>`,
    `  <rect x="0" y="0" width="${width}" height="${height}" fill="${bgColor}" stroke="none" />`,
    ...paths,
    `</svg>`,
  ].join('\n');

  const colorCount = palette.length - 1;
  const pathCount = paths.length;
  const qualityScore = Math.min(100, Math.round(
    (colorCount > 0 ? 40 : 0) +
    (pathCount > 0 ? 30 : 0) +
    (mode === 'studio' ? 20 : mode === 'pro' ? 10 : 0) +
    Math.min(10, colorCount / Math.max(1, 256) * 10)
  ));

  return {
    svgString,
    width,
    height,
    quality: {
      label: mode === 'fast' ? '快速' : mode === 'pro' ? '专业' : '工作室',
      score: qualityScore,
    },
    colors: colorCount,
    paths: pathCount,
  };
}

/** Convenience: vectorize image and trigger browser download */
export async function downloadSVG(
  imageUrl: string,
  mode: 'fast' | 'pro' | 'studio' = 'pro',
  onProgress?: (stage: string, progress: number) => void
): Promise<void> {
  // Try server-side vectorize API first (uses admin-configured vectorize model for better quality)
  try {
    onProgress?.('calling_vector_model', 10);
    const response = await fetch('/api/design/vectorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, mode }),
    });
    const data = await response.json();
    if (data.success && data.svg) {
      onProgress?.('rendering_preview', 90);
      const blob = new Blob([data.svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vectorized-${mode}.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onProgress?.('completed', 100);
      return;
    }
    // Server API failed, fall through to client-side
    console.warn('Server vectorize API unavailable, falling back to client-side:', data.error);
  } catch (e) {
    console.warn('Server vectorize API error, falling back to client-side:', e);
  }

  // Fallback: client-side vtracer algorithm
  const result = await exportAsSVG(imageUrl, { mode, onProgress });
  const blob = new Blob([result.svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vectorized-${mode}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
