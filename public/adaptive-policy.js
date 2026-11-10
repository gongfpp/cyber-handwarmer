// Hardware hints stay on this page. They are bounds, not exact model/temperature readings.
export const MODES = Object.freeze({
  gentle: { name: '轻柔', share: .25, duty: .40, gpuDuty: .30 },
  cozy: { name: '温暖', share: .65, duty: .82, gpuDuty: .60 },
  toasty: { name: '热烈', share: 1, duty: .85, gpuDuty: .85 },
});
export function deviceCapabilities(navigatorLike = navigator) {
  const touch = Number(navigatorLike.maxTouchPoints) > 0;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const mobile = navigatorLike.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|OpenHarmony/i.test(navigatorLike.userAgent || '') || (touch && (coarse || /Macintosh/i.test(navigatorLike.userAgent || '')));
  const reported = Number(navigatorLike.hardwareConcurrency);
  const memory = Number(navigatorLike.deviceMemory);
  const logical = Number.isFinite(reported) && reported >= 1 ? Math.min(64, Math.floor(reported)) : mobile ? 2 : 4;
  const memoryGiB = Number.isFinite(memory) && memory > 0 ? memory : null;
  const threadLimit = memoryGiB && memoryGiB <= 1 ? 4 : memoryGiB && memoryGiB <= 2 ? 8 : 64;
  return { mobile, cpuAvailable: typeof globalThis.Worker === 'function' && typeof globalThis.MessageChannel === 'function', logical, reportedCores: Number.isFinite(reported) && reported >= 1, memoryGiB, capacity: Math.min(logical, threadLimit) };
}
export function cpuProfile(mode, device) {
  const profile = MODES[mode] || MODES.gentle;
  const maxCount = Math.max(1, Math.ceil(device.capacity * profile.share));
  return { maxCount, targetDuty: profile.duty, initialCount: Math.max(1, (device.mobile ? Math.min(2, maxCount) : maxCount) - (mode === 'gentle' ? 0 : 1)), initialDuty: Math.min(.75, profile.duty) };
}
export function adaptCPU(current, profile, sample) {
  let { count, duty, healthy = 0, strained = 0 } = current;
  if (sample.mainLagMs > 80 || sample.workerOverrunMs > 180) {
    strained++; healthy = 0;
    if (strained >= 2) { count = Math.max(1, count - 1); duty = Math.max(.25, duty - .12); strained = 0; }
  } else if (sample.mainLagMs < 30 && sample.workerOverrunMs < 90) {
    healthy++; strained = 0;
    if (healthy >= 2) { count = Math.min(profile.maxCount, count + 1); duty = Math.min(profile.targetDuty, duty + .08); healthy = 0; }
  } else { healthy = 0; strained = 0; }
  return { count: Math.min(profile.maxCount, count), duty: Math.min(profile.targetDuty, duty), healthy, strained };
}
export function calibratedBatch(iterationsPerMs) {
  return Math.max(128, Math.min(8192, Math.round((Number(iterationsPerMs) || 600) * .35 / 32) * 32));
}
