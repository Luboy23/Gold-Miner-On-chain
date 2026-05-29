import Phaser from 'phaser';

export function areCirclesOverlapping(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const radius = ar + br;

  return dx * dx + dy * dy <= radius * radius;
}

export function getHookDirection(angleDeg: number): Phaser.Math.Vector2 {
  const angleRad = Phaser.Math.DegToRad(angleDeg);
  // Match the original Love2D implementation:
  // vector(0, 1):rotated(angle) => (-sin(angle), cos(angle))
  // This keeps the rope direction, collision point, and sprite rotation
  // on the same screen-space convention.
  return new Phaser.Math.Vector2(-Math.sin(angleRad), Math.cos(angleRad));
}
