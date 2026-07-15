import { performance } from 'node:perf_hooks';

const SAMPLE_COUNT = 1200;
const MAX_P95_MS = 100;

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function measure(operation) {
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const start = performance.now();
    operation(index);
    samples.push(performance.now() - start);
  }
  return percentile(samples, 0.95);
}

const canvasPanP95 = measure(index => {
  const x = (index * 17) % 2400;
  const y = (index * 29) % 1600;
  return `translate(${x}px, ${y}px) scale(1)`;
});

const nodes = Array.from({ length: 100 }, (_, index) => ({ id: `node-${index}`, x: index * 20, y: index * 12 }));
const nodeEditP95 = measure(index => nodes.map(node => node.id === 'node-50'
  ? { ...node, x: index, y: index * 2 }
  : node));

const messages = Array.from({ length: 200 }, (_, index) => ({ id: `message-${index}`, content: `message ${index}` }));
const chatHistoryP95 = measure(() => messages.slice(-80).map(message => message.id));

const report = {
  canvasPanP95,
  nodeEdit100P95: nodeEditP95,
  chatHistory200P95: chatHistoryP95,
  thresholdMs: MAX_P95_MS,
};

console.log(JSON.stringify(report, null, 2));
if (Object.values(report).some(value => typeof value === 'number' && value > MAX_P95_MS)) {
  process.exitCode = 1;
}
