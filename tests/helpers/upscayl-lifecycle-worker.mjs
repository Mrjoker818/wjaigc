// Controlled external interpreter fixture: real pipes/process, no inference model.
import fs from 'node:fs';

const [mode, image] = process.argv.slice(2);
if (mode === 'early-exit') {
  process.exitCode = 1;
} else if (mode === 'closed-input') {
  process.stdin.once('close', () => {
    process.stderr.write('ONNX_FIXTURE_PIPE_CLOSED\n');
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ success: true, image }));
    }, 300);
  });
  process.stdin.destroy();
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    const request = JSON.parse(input);
    process.stderr.write(`ONNX_FIXTURE_READY:${JSON.stringify(request)}\n`);
    if (mode === 'hang') setInterval(() => {}, 1000);
    else if (request.outputFile) {
      fs.writeFileSync(request.outputFile, Buffer.from(image, 'base64'));
      process.stdout.write(JSON.stringify({ success: true, outputFile: request.outputFile }));
    } else process.stdout.write(JSON.stringify({ success: true, image }));
  });
}
