const STOP_POSITIONS = [8.333, 25, 41.667, 58.333, 75, 91.667];

function createPlinkoRoute(random = Math.random) {
  const collisionY = [8, 21, 34, 47, 60];
  const points = [{ x: 50, y: -2 }];
  let x = 50;
  let rights = 0;

  collisionY.forEach((y) => {
    points.push({ x, y });
    const direction = random() >= .5 ? 1 : -1;
    if (direction > 0) rights += 1;
    x += direction * 8.3334;
  });

  points.push({ x: STOP_POSITIONS[rights], y: 89 });
  return { points, result: rights };
}

export { createPlinkoRoute };
