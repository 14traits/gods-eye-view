/**
 * Device orientation to the virtual camera's Y-up pose frame (+x right,
 * +y up, -z forward), shared by the phone page and its tests.
 */
export const quat = {
  multiply(a, b) {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  },
  axisAngle(axis, angle) {
    const s = Math.sin(angle / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
  },
};
const DEG = Math.PI / 180;
// Device orientation is device→earth (x east, y north, z up). Rotating -90°
// about x maps that earth frame to the Y-up frame (north becomes -z).
const EARTH_TO_Y_UP = quat.axisAngle([1, 0, 0], -Math.PI / 2);

/** W3C DeviceOrientation (Z-X'-Y'') to a Y-up quaternion for the current screen orientation. */
export function orientationQuaternion(alpha, beta, gamma, screenAngle) {
  const x = (beta || 0) * DEG;
  const y = (gamma || 0) * DEG;
  const z = (alpha || 0) * DEG;
  const cX = Math.cos(x / 2);
  const cY = Math.cos(y / 2);
  const cZ = Math.cos(z / 2);
  const sX = Math.sin(x / 2);
  const sY = Math.sin(y / 2);
  const sZ = Math.sin(z / 2);
  const device = [
    sX * cY * cZ - cX * sY * sZ,
    cX * sY * cZ + sX * cY * sZ,
    cX * cY * sZ + sX * sY * cZ,
    cX * cY * cZ - sX * sY * sZ,
  ];
  const screen = quat.axisAngle([0, 0, 1], -(screenAngle || 0) * DEG);
  return quat.multiply(EARTH_TO_Y_UP, quat.multiply(device, screen));
}
