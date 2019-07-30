let fps = 10;
let epsilon = 3;
let smoothWindow = 5;
let sampleCount = 2000;
let contourDedupThresh = 10;
let contourThreshold = 100;
let threshBinaryInv = false;
let circleSample = 1.0;
let height = 400, width = 400;
let state = {
};
let steps = [
  extractPolygons,
  drawContours,
  downSamplePoints,
  drawPoints,
  drawDelaunay,
  mst,
  makeEulerGraph,
  drawGraph,
  createPath,
  simplifyPath,
  drawPath,
  fft,
  initAnimation,
];

function initCanvasSize(canvas) {
  canvas.width = width;
  canvas.height = height;
}

function downSamplePoints() {
  state.points = getRandomSubarray(state.originalPoints, Math.min(state.originalPoints.length, sampleCount));
}

function runSteps(start) {
  let toRun = [...steps];
  if (start) {
    while (toRun.length && toRun[0] != start) {
      toRun.shift();
    }
  }
  while (toRun.length) {
    let step = toRun.shift();
    step();
  }
}

function processImage() {
  let image = document.getElementById('image');
  let h = image.height, w = image.width;
  let ratio = Math.min(600 / h, 600 / w);
  height = h * ratio;
  width = w * ratio;
  let canvas = document.getElementById('resized_image');
  initCanvasSize(canvas);
  let ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, w * ratio, h * ratio);
  let src = cv.imread('resized_image');
  cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);

  cv.threshold(src, src, contourThreshold, 255, threshBinaryInv ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY);

  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
  src.delete();
  hierarchy.delete();
  state.contours = contours;
  runSteps();
}

function updateImageUrl() {
  let image = document.getElementById('image');
  image.src = '/proxy?url=' + encodeURIComponent(document.getElementById('url').value);
}

function init() {
  let image = document.getElementById('image');
  image.crossOrigin = "Anonymous";
  let fpsSlider = document.getElementById('fps');
  fpsSlider.oninput = function() {
    fps = this.value;
  }
  let epsilonSlider = document.getElementById('epsilon');
  epsilonSlider.oninput = function() {
    epsilon = this.value;
    runSteps(simplifyPath);
  }
  let sampleSlider = document.getElementById('sample_slider');
  sampleSlider.oninput = function() {
    sampleCount = this.value;
    runSteps(downSamplePoints);
  };
  let smoothWindowSlider = document.getElementById('smooth_window');
  smoothWindowSlider.oninput = function() {
    smoothWindow = parseInt(this.value);
    if (smoothWindow < 5) smoothWindow = 5;
    runSteps(simplifyPath);
  };
  let contourDedupeSlider = document.getElementById('contour_dedupe_slider');
  contourDedupeSlider.oninput = function() {
    contourDedupThresh = this.value;
    runSteps(extractPolygons);
  };
  let controlThreshold = document.getElementById('contour_thresh_slider');
  controlThreshold.oninput = function() {
    contourThreshold = parseFloat(this.value);
    processImage();
  };
  let circleSampleSlider = document.getElementById('circle_sample_slider');
  circleSampleSlider.oninput = function() {
    circleSample = parseFloat(this.value);
    runSteps(initAnimation);
  };
  let checkbox = document.getElementById('thresh_binary_inv');
  checkbox.onclick = function() {
    threshBinaryInv = this.checked;
    processImage();
  };
  cv['onRuntimeInitialized'] = () => {
    updateImageUrl();
  }
}

function range(n) {
  let res = [];
  for (let i = 0; i < n; i++) {
    res.push(i);
  }
  return res;
}

var stop;

function fft() {
  let simplifiedPath = state.simplifiedPath;
  let real = simplifiedPath.map(p => p[0]), imag = simplifiedPath.map(p => p[1]);
  transform(real, imag);
  state.real = real;
  state.imag = imag;
}

function initAnimation() {
  let real = state.real;
  let imag = state.imag;
  let N = real.length;
  let n = Math.floor(N * circleSample);
  let idx = [];
  for (let i = 0; i < real.length; i++) {
    if (i < Math.floor((n + 1) / 2) || i >= N - Math.floor(n / 2)) {
      idx.push(i);
    }
  }
  console.log(`${n} circles`);
  let canvas = document.getElementById('circle');
  initCanvasSize(canvas);
  let ctx = canvas.getContext("2d");
  let t = 0;
  let radius = [], sinTable = [], cosTable = [], path = [];
  for (let i = 0; i < N; i++) {
    radius[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / N;
    sinTable[i] = Math.sin(2 * Math.PI * i / N);
    cosTable[i] = Math.cos(2 * Math.PI * i / N);
  }
  let running = true;
  if (stop) {
    stop();
  }
  stop = () => running = false;
  function _render(t) {
    if (!running) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height); // clear canvas
    let p = [0, 0];
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    idx.forEach(i => {
      ctx.moveTo(p[0] + radius[i], p[1]);
      ctx.arc(p[0], p[1], radius[i], 0, Math.PI * 2, true);
      ctx.moveTo(p[0], p[1]);
      let sin = sinTable[i * t % N];
      let cos = cosTable[i * t % N];
      p = [
        p[0] + 1.0 / N * (real[i] * cos + imag[i] * sin),
        p[1] + 1.0 / N * (- real[i] * sin + imag[i] * cos)
      ];
      ctx.lineTo(p[0], p[1]);
    });
    path.push(p);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i][0], path[i][1]);
    }
    ctx.stroke();
  }

  function render() {
    _render(t);
    t++;
    if (t == N) {
      t = 0;
      path = [];
      setTimeout(render, 1000);
    } else {
      setTimeout(render, 1000.0 / fps)
    }
  }
  render();
}

function getRandomSubarray(arr, size) {
  var shuffled = arr.slice(0), i = arr.length, temp, index;
  while (i--) {
    index = Math.floor((i + 1) * Math.random());
    temp = shuffled[index];
    shuffled[index] = shuffled[i];
    shuffled[i] = temp;
  }
  return shuffled.slice(0, size);
}

function nextHalfedge(e) { return (e % 3 === 2) ? e - 2 : e + 1; }


function dis(a, b) {
  let x = a[0] - b[0], y = a[1] - b[1];;
  return x * x + y * y;
}

function extractPolygons() {
  let contours = state.contours;
  let polygons = [];
  let kd = new kdTree([], dis, [0, 1]);
  for (let i = 0; i < contours.size(); i++) {
    let contour = contours.get(i).data32S;
    let polygon = [];
    let newPoints = [];
    for (let j = 0; j < contour.length; j += 2) {
      let point = [contour[j], contour[j + 1]];
      let neighbors = kd.nearest(point, 1, contourDedupThresh);
      if (neighbors.length) {
        point = neighbors[0][0]
      } else {
        newPoints.push(point);
      }
      polygon.push(point);
    }
    polygons.push(polygon);
    newPoints.forEach(point => kd.insert(point));
  }
  state.polygons = polygons
}

function drawContours() {
  let polygons = state.polygons;
  let canvas = document.getElementById('contour');
  initCanvasSize(canvas);
  let ctx = canvas.getContext('2d');
  console.log(`${polygons.length} contours`);
  let points = [];
  for (let i = 0; i < polygons.length; i++) {
    let polygon = polygons[i];
    for (let j = 0; j < polygon.length; j++) {
      let p = polygon[j];
      let q = j == polygon.length - 1 ? polygon[0] : polygon[j + 1];
      points.push(p);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
  }
  state.originalPoints =  [... new Set(points)];
}

function drawDelaunay() {
  let points = state.points;
  let canvas = document.getElementById('delaunay');
  initCanvasSize(canvas);
  let ctx = canvas.getContext('2d');
  const delaunay = Delaunator.from(points);
  const triangles = delaunay.triangles;
  let edges = [];
  for (let e = 0; e < delaunay.triangles.length; e++) {
    if (e > delaunay.halfedges[e]) {
      const i = delaunay.triangles[e];
      const j = delaunay.triangles[nextHalfedge(e)];
      edges.push([i, j, dis(points[i], points[j])])
    }
  }
  edges.forEach(([a, b]) => {
    drawLine(ctx, points[a], points[b]);
  });
  edges.sort(function (a, b) {
    return b[2] - a[2];
  });
  state.edges = edges;
}

function drawLine(ctx, p1, p2) {
  ctx.beginPath();
  ctx.moveTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.stroke();
}

function mst() {
  let points = state.points;
  let edges = state.edges;
  function union(p, i, j) {
    p[find(p, i)] = find(p, j);
  }

  function find(p, i) {
    if (p[i] == i) {
      return i;
    }
    return p[i] = find(p, p[i]);
  }
  let nodes = new Set();
  edges.forEach(([a,b]) => {
    nodes.add(a);
    nodes.add(b);
  });
  let p = range(points.length);
  let g = [];
  for (let i = 0; i < points.length; i++) {
    g.push([]);
  }
  let cc = nodes.size;
  while (cc > 1) {
    let [i, j, _] = edges.pop();
    if (find(p, i) != find(p, j)) {
      let p1 = points[i];
      let p2 = points[j];
      union(p, i, j);
      g[i].push(j);
      g[j].push(i);
      cc--;
    }
  }
  state.g = g;
}

function makeEulerGraph() {
  let g = state.g;
  let points = state.points;
  let oddNodes = [];
  points.forEach((p, i) => {
    if (g[i].length % 2 == 1) {
      oddNodes.push(i);
    }
  });
  let kd = new kdTree([], dis, [0, 1]);
  oddNodes.forEach(i=> {
    let p = points[i];
    let neighbors = kd.nearest(p, 1, 400);
    if (neighbors.length) {
      let q = neighbors[0][0];
      let j = q[2];
      g[i].push(j);
      g[j].push(i);
      kd.remove(q);
    } else {
      kd.insert([p[0], p[1], i]);
    }
  });
  oddNodes = new Set();
  let inv = {};
  points.forEach((p, i) => {
    if (g[i].length % 2 == 1) {
      inv[i] = oddNodes.size;
      oddNodes.add(i);
    }
  });
  let sp = [];
  let sp2 = [];
  for (let i = 0; i < oddNodes.size; i++) {
    sp2.push([]);
  }
  oddNodes.forEach(i0 => {
    let q = [i0];
    let vis = new Set();
    let back = {};
    vis.add(i0);
    while (q.length) {
      let i = q.pop();
      if (i > i0 && oddNodes.has(i)) {
        let j0 = i;
        let path = [i];
        while (i != i0) {
          i = back[i];
          path.unshift(i);
        }
        sp.push([inv[i0], inv[j0], -path.length]);
        sp2[inv[i0]][inv[j0]] = path;
        sp2[inv[j0]][inv[i0]] = path;
      }
      g[i].forEach(j => {
        if (!vis.has(j)) {
          vis.add(j);
          q.unshift(j);
          back[j] = i;
        }
      });
    }
  });
  let res = blossom(sp, true);
  console.log(`blossom matching: ${res}`);
  let matches = [];
  res.forEach((i, j) => {
    if (i >= 0 && i < j) {
      matches.push([i,j]);
    }
  });
  matches.sort((a,b) => {
    let i1 = a[0], j1 = a[1];
    let i2 = b[0], j2 = b[1];
    return  sp2[i1][j1].length - sp2[i2][j2].length;
  });
  matches.forEach(([i, j]) => {
    let path = sp2[i][j];
    for (let k = 1; k < path.length; k++) {
      let a = path[k-1], b = path[k];
      g[a].push(b);
      g[b].push(a);
    }
  });
}

function drawPath() {
  let path = state.simplifiedPath;
  let canvas = document.getElementById('path');
  let ctx = canvas.getContext('2d');
  initCanvasSize(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.moveTo(path[0][0], path[0][1]);
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i][0], path[i][1]);
  }
  ctx.stroke();
  let n = path.length;
  console.log(`${n} points in simplified path`);
}

function simplifyPath() {
  let path = state.path;
  let x = path.map(p => p[0]), y = path.map(p => p[1]);
  x = SavitzkyGolay(x, { windowSize: smoothWindow });
  y = SavitzkyGolay(y, { windowSize: smoothWindow });
  path = x.map((v, i) => [v, y[i]]);
  path = simplify(path, epsilon, false);
  state.simplifiedPath = path;
}

function createPath() {
  let g = state.g;
  let points = state.points;
  let path = [];
  let deleted = [];
  console.log(`${points.length} points`);
  for (let i = 0; i < points.length; i++) {
    deleted.push([]);
  }
  function dfs(i) {
    while (g[i].length) {
      let j = g[i].pop();
      if (deleted[i][j]) {
        deleted[i][j]--;
        continue;
      }
      if (!deleted[j][i]) {
        deleted[j][i] = 0;
      } 
      deleted[j][i]++;
      dfs(j);
    }
    path.push(points[i]);
  }

  dfs(0); 
  console.log(`${path.length} points in path`);
  state.path = path;
}

function drawPoint(ctx, p) {
  ctx.beginPath();
  ctx.arc(p[0], p[1], 3, 0, 2 * Math.PI, false);
  ctx.fillStyle = 'green';
  ctx.fill();
}

function drawPoints() {
  let points = state.points;
  let canvas = document.getElementById('samples');
  initCanvasSize(canvas);
  let ctx = canvas.getContext('2d');
  for (let i = 0; i < points.length; i++) {
    drawPoint(ctx, points[i]);
  }
}

function drawGraph() {
  let points = state.points;
  let g = state.g;
  let canvas = document.getElementById('graph');
  initCanvasSize(canvas);
  let ctx = canvas.getContext('2d');
  g.forEach((next, i) => {
    next.forEach(j => {
      drawLine(ctx, points[i], points[j]);
    });
  });
}

