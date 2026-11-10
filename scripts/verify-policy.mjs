import assert from 'node:assert/strict';
import { deviceCapabilities, cpuProfile, adaptCPU, calibratedBatch } from '../public/adaptive-policy.js';
const device = cores => deviceCapabilities({ hardwareConcurrency: cores });
assert.equal(cpuProfile('toasty', device(2)).maxCount, 2);
assert.equal(cpuProfile('toasty', device(8)).maxCount, 8);
assert.equal(cpuProfile('toasty', device(32)).maxCount, 32);
assert.equal(cpuProfile('gentle', device(8)).maxCount, 2);
assert.equal(cpuProfile('cozy', device(8)).maxCount, 6);
assert.equal(deviceCapabilities({}).logical, 4);
assert.equal(deviceCapabilities({}).reportedCores, false);
assert.equal(deviceCapabilities({ hardwareConcurrency: 16, deviceMemory: 1 }).capacity, 4);
const profile = cpuProfile('toasty', device(8));
let current = { count: profile.initialCount, duty: profile.initialDuty };
for (let i = 0; i < 20; i++) current = adaptCPU(current, profile, { mainLagMs: 5, workerOverrunMs: 2 });
assert.equal(current.count, 8); assert.equal(current.duty, .85);
const singleSpike = adaptCPU(current, profile, { mainLagMs: 150, workerOverrunMs: 200 });
assert.equal(singleSpike.count, 8);
const backedOff = adaptCPU(singleSpike, profile, { mainLagMs: 150, workerOverrunMs: 200 });
assert.equal(backedOff.count, 7); assert(backedOff.duty < .85);
const gentle = adaptCPU(current, cpuProfile('gentle', device(8)), { mainLagMs: 5, workerOverrunMs: 2 });
assert.equal(gentle.count, 2); assert.equal(gentle.duty, .4);
assert.equal(calibratedBatch(.01), 128); assert.equal(calibratedBatch(1e9), 8192);
console.log('自适应策略：2 / 8 / 32 核、信息缺失、低内存、渐进升载、持续卡顿降载、单次抖动及切档边界通过。');

for (const userAgent of ['iPhone', 'Android Mobile', 'HarmonyOS', 'OpenHarmony', 'Macintosh']) {
  const mobile = deviceCapabilities({ hardwareConcurrency: 8, userAgent, maxTouchPoints: 5 });
  assert(mobile.mobile); assert(cpuProfile('toasty', mobile).initialCount <= 2);
  assert.equal(cpuProfile('toasty', mobile).maxCount, 8);
}
assert.equal(deviceCapabilities({ userAgent: 'iPhone', maxTouchPoints: 5 }).logical, 2);
console.log('移动策略：iOS / 安卓 / 鸿蒙 / iPad 的低起步调度与缺失信息回退通过；能力是否可用由实际接口验证。');
