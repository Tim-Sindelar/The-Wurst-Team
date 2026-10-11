/* Sample room outlines stand in for future backend floor-map data. */
const geometry = (() => {
  'use strict';
  const UNITS_PER_METER = 64;
  function roomFromCoordinates(data) {
    const boundary = data.boundary || data.points;
    // Holes (pillars, shafts) are drawn but not checked: placing around them is up to the admin.
    const holes = data.holes || [];
    const ring = (r) =>
      Array.isArray(r) &&
      r.length >= 3 &&
      r.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          p.every((v) => Number.isFinite(v)),
      );
    if (!ring(boundary))
      throw Error(
        'Use a room boundary with at least three finite coordinate pairs.',
      );
    if (!Array.isArray(holes) || !holes.every(ring))
      throw Error('Use holes with at least three finite coordinate pairs.');
    const metersPerUnit =
      { m: 1, cm: 0.01, mm: 0.001 }[data.coordinateUnit] ??
      (data.coordinateUnit === 'plan' ? data.metersPerUnit : undefined);
    if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0)
      throw Error(
        'Room coordinates need a physical unit or a known meters-per-unit scale. A GPS location alone does not give room size.',
      );
    const originX = Math.min(...boundary.map((p) => p[0])),
      originY = Math.min(...boundary.map((p) => p[1]));
    const maxX = Math.max(...boundary.map((p) => p[0])),
      maxY = Math.max(...boundary.map((p) => p[1]));
    const widthMeters = (maxX - originX) * metersPerUnit,
      heightMeters = (maxY - originY) * metersPerUnit;
    const ringArea = (r) =>
      (Math.abs(
        r.reduce((sum, [x, y], i) => {
          const [nx, ny] = r[(i + 1) % r.length];
          return (
            sum +
            (x - originX) * (ny - originY) -
            (nx - originX) * (y - originY)
          );
        }, 0),
      ) /
        2) *
      metersPerUnit ** 2;
    const outerArea = ringArea(boundary);
    const areaSquareMeters = holes.reduce(
      (area, hole) => area - ringArea(hole),
      outerArea,
    );
    if (widthMeters <= 0 || heightMeters <= 0 || outerArea <= 0)
      throw Error('The room boundary must enclose an area.');
    const scale = metersPerUnit * UNITS_PER_METER,
      padding = 28;
    const toCanvas = (r) =>
      r.map(([x, y]) => [
        padding + (x - originX) * scale,
        padding +
          (data.coordinateAxis === 'cartesian' ? maxY - y : y - originY) *
            scale,
      ]);
    const points = toCanvas(boundary);
    return {
      ...data,
      points,
      ...(holes.length ? { holes: holes.map(toCanvas) } : {}),
      width: widthMeters * UNITS_PER_METER + padding * 2,
      height: heightMeters * UNITS_PER_METER + padding * 2,
      measurements: {
        widthMeters,
        heightMeters,
        areaSquareMeters,
        unitsPerMeter: UNITS_PER_METER,
        approximate: data.approximate === true,
      },
      sourceTransform: {
        originX,
        originY,
        maxY,
        scale,
        padding,
        axis: data.coordinateAxis || 'screen',
      },
    };
  }
  function sourcePoint(room, x, y) {
    const t = room.sourceTransform;
    if (!t) throw Error('This room has no coordinate transform.');
    if (t.canvasTransform) {
      const a = (t.canvasTransform.rotation * Math.PI) / 180;
      const dx = x - t.canvasTransform.offsetX,
        dy = y - t.canvasTransform.offsetY;
      x = dx * Math.cos(a) + dy * Math.sin(a);
      y = -dx * Math.sin(a) + dy * Math.cos(a);
    }
    return {
      x: t.originX + (x - t.padding) / t.scale,
      y:
        t.axis === 'cartesian'
          ? t.maxY - (y - t.padding) / t.scale
          : t.originY + (y - t.padding) / t.scale,
    };
  }
  const rooms = [
    {
      id: 'hg-e-11',
      label: 'HG E 1.1',
      kind: 'Library',
      building: 'HG · Floor E',
      width: 640,
      height: 760,
      points: [
        [28, 28],
        [612, 28],
        [612, 450],
        [510, 450],
        [510, 732],
        [28, 732],
      ],
    },
    {
      id: 'hg-e-3',
      label: 'HG E 3',
      kind: 'Auditorium',
      building: 'HG · Floor E',
      width: 640,
      height: 760,
      points: [
        [90, 28],
        [550, 28],
        [612, 732],
        [28, 732],
      ],
    },
    {
      id: 'hg-e-5',
      label: 'HG E 5',
      kind: 'Study room',
      building: 'HG · Floor E',
      width: 640,
      height: 760,
      points: [
        [28, 28],
        [612, 28],
        [612, 732],
        [280, 732],
        [280, 540],
        [28, 540],
      ],
    },
  ].map((data) =>
    roomFromCoordinates({
      ...data,
      coordinateUnit: 'plan',
      metersPerUnit: 1 / UNITS_PER_METER,
      approximate: true,
    }),
  );
  const room = (id) => rooms.find((r) => r.id === id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function contains(r, x, y) {
    let inside = false;
    for (let i = 0, j = r.points.length - 1; i < r.points.length; j = i++) {
      const a = r.points[i],
        b = r.points[j];
      if (
        a[1] > y !== b[1] > y &&
        x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
    return inside;
  }
  function wallPoint(r, x, y, length = 60) {
    let best = null;
    r.points.forEach((a, i) => {
      const b = r.points[(i + 1) % r.points.length],
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        len = Math.hypot(dx, dy);
      if (len < length) return;
      const margin = length / 2 / len,
        t = Math.max(
          margin,
          Math.min(
            1 - margin,
            ((x - a[0]) * dx + (y - a[1]) * dy) / (len * len),
          ),
        );
      const px = a[0] + t * dx,
        py = a[1] + t * dy,
        distance = Math.hypot(x - px, y - py);
      if (!best || distance < best.distance)
        best = {
          x: px,
          y: py,
          angle:
            (Math.atan2(dy, dx) * 180) / Math.PI +
            (contains(r, px - (dy / len) * 4, py + (dx / len) * 4) ? 0 : 180),
          distance,
        };
    });
    return best;
  }
  // Tables, seat rows and their seats carry the layout's furniture size as
  // `scale` (1 = physical size). Stored width and height stay unscaled, so
  // presets and limits don't change; this returns the size drawn in the room.
  function actual(o) {
    const k = o.scale ?? 1;
    if (o.type === 'seat') return { ...o, width: 32 * k, height: 36 * k };
    if (o.type !== 'table' || k === 1) return o;
    return { ...o, width: o.width * k, height: o.height * k, scale: 1 };
  }
  function valid(r, o) {
    if (o.type === 'table' && o.shape === 'curved')
      return shapeParts(o).every((p) => valid(r, p));
    if (o.type === 'row') return true;
    if (o.type === 'window' || o.type === 'door')
      return !!wallPoint(r, o.x, o.y, o.width);
    const size = actual(o),
      w = size.width,
      h = size.height,
      angle = (o.angle * Math.PI) / 180;
    const polygon = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ].map(([x, y]) => [
      o.x + x * Math.cos(angle) - y * Math.sin(angle),
      o.y + x * Math.sin(angle) + y * Math.cos(angle),
    ]);
    if (!polygon.every(([x, y]) => contains(r, x, y))) return false;
    const cross = (a, b, c) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    // Corners alone miss a rectangle bridging a concave notch.
    return polygon.every((a, i) => {
      const b = polygon[(i + 1) % 4];
      return r.points.every((c, j) => {
        const d = r.points[(j + 1) % r.points.length];
        return !(
          cross(a, b, c) * cross(a, b, d) < -0.00001 &&
          cross(c, d, a) * cross(c, d, b) < -0.00001
        );
      });
    });
  }

  // Fixed physical scale: 64 canvas units per meter. Mock room dimensions are approximate.
  const SEAT_GAP = 8,
    SEAT_PITCH = 48,
    SNAP_DISTANCE = 100;

  function world(o, x, y, angle = 0) {
    const a = (o.angle * Math.PI) / 180;
    return {
      tableId: o.id,
      x: o.x + x * Math.cos(a) - y * Math.sin(a),
      y: o.y + x * Math.sin(a) + y * Math.cos(a),
      angle: (o.angle + angle + 360) % 360,
    };
  }
  // Slots are laid out at physical size around the origin, then scaled by the
  // item's furniture size and placed at the item.
  function scaledSlots(o, compute) {
    const k = o.scale ?? 1;
    return compute({ ...o, x: 0, y: 0, angle: 0, scale: 1 }).map((s) => ({
      ...world(o, s.x * k, s.y * k, s.angle),
      slot: s.slot,
      scale: k,
    }));
  }
  // Seat rows space seats 48 apart (56 along a curve) and rows 64 apart;
  // seatSpacing and rowSpacing are percentages of that.
  function rowMetrics(o) {
    const span = (o.sweep * Math.PI) / 180,
      column = (o.seatSpacing ?? 100) / 100,
      step = (64 * (o.rowSpacing ?? 100)) / 100;
    const radius = span
      ? Math.max(
          o.radius,
          (56 * column) / (2 * Math.sin(span / Math.max(1, o.count - 1) / 2)),
        )
      : 0;
    const pitch =
      span && o.count > 1
        ? Math.max(56 * column, 2 * radius * Math.sin(span / (o.count - 1) / 2))
        : 48 * column;
    return { span, radius, pitch, step };
  }
  function rowSlots(o, equalCounts = false) {
    return scaledSlots(o, (row) => baseRowSlots(row, equalCounts));
  }
  function baseRowSlots(o, equalCounts) {
    const result = [],
      { span, radius, pitch, step } = rowMetrics(o);
    for (let row = 0; row < o.rows; row++) {
      const r = radius + row * step;
      const count =
        !span || !row || equalCounts
          ? o.count
          : Math.max(
              o.count,
              Math.floor(span / (2 * Math.asin(pitch / (2 * r))) + 1e-9) + 1,
            );
      for (let i = 0; i < count; i++) {
        const a = count > 1 ? (i / (count - 1) - 0.5) * span : 0;
        const x = span ? r * Math.sin(a) : (i - (count - 1) / 2) * pitch;
        const y = span ? r * Math.cos(a) - radius : row * step;
        result.push({
          ...world(o, x, y, (-a * 180) / Math.PI),
          slot: 'row' + row + ':' + i,
        });
      }
    }
    return result;
  }
  // Quadratic arc, sampled once for rendering, seat spacing and collision strips.
  function curvePoints(table) {
    const sag = (table.width * 0.35 * (table.curvature ?? 60)) / 100;
    return Array.from({ length: 41 }, (_, i) => {
      const t = i / 40;
      const x = table.width * (t - 0.5),
        y = sag / 2 - 4 * sag * t * (1 - t);
      const slope = (4 * sag * (2 * t - 1)) / table.width;
      const norm = Math.hypot(1, slope);
      return {
        x,
        y,
        nx: slope / norm,
        ny: -1 / norm,
        angle: (Math.atan(slope) * 180) / Math.PI,
      };
    });
  }
  function curveOutline(table) {
    const points = curvePoints(table),
      depth = table.height / 2;
    return [
      ...points.map((p) => [p.x + p.nx * depth, p.y + p.ny * depth]),
      ...points
        .toReversed()
        .map((p) => [p.x - p.nx * depth, p.y - p.ny * depth]),
    ];
  }
  function curveSlots(table) {
    const points = curvePoints(table),
      lengths = [0];
    for (let i = 1; i < points.length; i++)
      lengths.push(
        lengths[i - 1] +
          Math.hypot(
            points[i].x - points[i - 1].x,
            points[i].y - points[i - 1].y,
          ),
      );
    const total = lengths.at(-1),
      count = Math.max(0, Math.floor((total - 32) / 56) + 1),
      result = [];
    for (const [side, sign] of [
      ['top', 1],
      ['bottom', -1],
    ]) {
      for (let i = 0; i < count; i++) {
        const distance = total / 2 + (i - (count - 1) / 2) * 56;
        let j = lengths.findIndex((d) => d >= distance);
        j = Math.max(1, j);
        const f = (distance - lengths[j - 1]) / (lengths[j] - lengths[j - 1]);
        const a = points[j - 1],
          b = points[j],
          x = a.x + (b.x - a.x) * f,
          y = a.y + (b.y - a.y) * f;
        const angle = a.angle + (b.angle - a.angle) * f,
          radians = (angle * Math.PI) / 180;
        result.push({
          ...world(
            table,
            x + sign * Math.sin(radians) * (table.height / 2 + 26),
            y - sign * Math.cos(radians) * (table.height / 2 + 26),
            angle + (sign === 1 ? 0 : 180),
          ),
          slot: side + ':' + i,
        });
      }
    }
    if (table.height >= 32)
      for (const [side, index, sign] of [
        ['left', 0, -1],
        ['right', 40, 1],
      ]) {
        const p = points[index],
          a = (p.angle * Math.PI) / 180;
        result.push({
          ...world(
            table,
            p.x + sign * Math.cos(a) * 26,
            p.y + sign * Math.sin(a) * 26,
            p.angle + (sign === 1 ? 270 : 90),
          ),
          slot: side + ':0',
        });
      }
    const accepted = [];
    for (const s of result) {
      const seat = { ...s, type: 'seat', width: 32, height: 36 };
      if (
        !overlaps(seat, table) &&
        !accepted.some((p) =>
          overlaps(seat, { ...p, type: 'seat', width: 32, height: 36 }),
        )
      )
        accepted.push(s);
    }
    return accepted;
  }
  function slots(table) {
    return scaledSlots(table, baseSlots);
  }
  function baseSlots(table) {
    if (table.shape === 'curved') return curveSlots(table);
    if (table.type === 'row') return baseRowSlots(table, false);
    if (table.shape === 'round') {
      const radius = table.width / 2 + 26,
        count = Math.max(1, Math.floor((2 * Math.PI * radius) / 56));
      return Array.from({ length: count }, (_, i) => {
        const a = (2 * Math.PI * i) / count;
        return {
          ...world(
            table,
            radius * Math.sin(a),
            -radius * Math.cos(a),
            (a * 180) / Math.PI,
          ),
          slot: 'rim:' + i,
        };
      });
    }
    if (table.shape === 'l') {
      const result = [],
        arm = 32;
      const edges = [
        ['top', -table.width / 2, -table.height / 2, table.width, 0, 0],
        ['right', table.width / 2, -table.height / 2, arm, 1, 270],
        [
          'inner-top',
          -table.width / 2 + arm,
          -table.height / 2 + arm,
          table.width - arm,
          0,
          180,
        ],
        [
          'inner-left',
          -table.width / 2 + arm,
          -table.height / 2 + arm,
          table.height - arm,
          1,
          270,
        ],
        ['bottom', -table.width / 2, table.height / 2, arm, 0, 180],
        ['left', -table.width / 2, -table.height / 2, table.height, 1, 90],
      ];
      for (const [side, x, y, len, vertical, rotation] of edges) {
        const count = Math.max(0, Math.floor((len - 32) / 48) + 1);
        for (let i = 0; i < count; i++) {
          const along = len / 2 + (i - (count - 1) / 2) * 48;
          const nx = rotation === 90 ? -26 : rotation === 270 ? 26 : 0;
          const ny = rotation === 0 ? -26 : rotation === 180 ? 26 : 0;
          result.push({
            ...world(
              table,
              x + (vertical ? 0 : along) + nx,
              y + (vertical ? along : 0) + ny,
              rotation,
            ),
            slot: side + ':' + i,
          });
        }
      }
      return result.filter(
        (seat) =>
          !shapeParts(table).some((part) =>
            rectangleOverlap(
              { ...seat, type: 'seat', width: 32, height: 36 },
              part,
            ),
          ),
      );
    }
    const result = [],
      angle = (table.angle * Math.PI) / 180;
    for (const [side, length, offset, rotation] of [
      ['top', table.width, -table.height / 2 - 18 - SEAT_GAP, 0],
      ['bottom', table.width, table.height / 2 + 18 + SEAT_GAP, 180],
      ['left', table.height, -table.width / 2 - 18 - SEAT_GAP, 90],
      ['right', table.height, table.width / 2 + 18 + SEAT_GAP, 270],
    ]) {
      const count = Math.floor((length - 32) / SEAT_PITCH) + 1;
      for (let i = 0; i < count; i++) {
        const along = (i - (count - 1) / 2) * SEAT_PITCH;
        const x = side === 'top' || side === 'bottom' ? along : offset;
        const y = side === 'top' || side === 'bottom' ? offset : along;
        result.push({
          tableId: table.id,
          slot: side + ':' + i,
          x: table.x + x * Math.cos(angle) - y * Math.sin(angle),
          y: table.y + x * Math.sin(angle) + y * Math.cos(angle),
          angle: (table.angle + rotation) % 360,
        });
      }
    }
    return result;
  }
  function corners(o) {
    const { width: w, height: h } = actual(o);
    const a = (o.angle * Math.PI) / 180;
    return [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ].map(([x, y]) => [
      o.x + x * Math.cos(a) - y * Math.sin(a),
      o.y + x * Math.sin(a) + y * Math.cos(a),
    ]);
  }
  function rectangleOverlap(a, b) {
    const pa = corners(a),
      pb = corners(b);
    for (const points of [pa, pb])
      for (let i = 0; i < 4; i++) {
        const p = points[i],
          q = points[(i + 1) % 4],
          axis = [q[1] - p[1], p[0] - q[0]];
        const project = (polygon) =>
          polygon.map((v) => v[0] * axis[0] + v[1] * axis[1]);
        const aa = project(pa),
          bb = project(pb);
        if (
          Math.max(...aa) <= Math.min(...bb) + 0.00001 ||
          Math.max(...bb) <= Math.min(...aa) + 0.00001
        )
          return false;
      }
    return true;
  }

  function shapeParts(o) {
    const arm = 32 * (o.type === 'table' ? (o.scale ?? 1) : 1);
    o = actual(o);
    if (o.type === 'table' && o.shape === 'curved') {
      const points = curvePoints(o);
      return points.slice(1).map((p, i) => {
        const a = points[i];
        return {
          ...o,
          ...world(o, (a.x + p.x) / 2, (a.y + p.y) / 2),
          angle: o.angle + (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI,
          width: Math.hypot(p.x - a.x, p.y - a.y) + 0.5,
          height: o.height,
          shape: 'rectangle',
        };
      });
    }
    if (o.type === 'table' && o.shape === 'l') {
      return [
        {
          ...o,
          ...world(o, 0, -o.height / 2 + arm / 2),
          width: o.width,
          height: arm,
          shape: 'rectangle',
        },
        {
          ...o,
          ...world(o, -o.width / 2 + arm / 2, arm / 2),
          width: arm,
          height: Math.max(0, o.height - arm),
          shape: 'rectangle',
        },
      ].filter((p) => p.height > 0);
    }
    if (o.type === 'table' && o.shape === 'round') {
      // Convex polygon approximation of the circular tabletop.
      return [o];
    }
    return [o];
  }
  function overlaps(a, b) {
    if (a.type === 'row' || b.type === 'row') return false;
    return shapeParts(a).some((pa) =>
      shapeParts(b).some((pb) => {
        if (pa.shape === 'round' || pb.shape === 'round') {
          const circle = pa.shape === 'round' ? pa : pb,
            other = circle === pa ? pb : pa;
          if (other.shape === 'round')
            return (
              Math.hypot(circle.x - other.x, circle.y - other.y) <
              (circle.width + other.width) / 2 - 0.001
            );
          const angle = (-other.angle * Math.PI) / 180,
            dx = circle.x - other.x,
            dy = circle.y - other.y;
          const x = dx * Math.cos(angle) - dy * Math.sin(angle),
            y = dx * Math.sin(angle) + dy * Math.cos(angle);
          const cx = Math.max(-other.width / 2, Math.min(other.width / 2, x)),
            cy = Math.max(-other.height / 2, Math.min(other.height / 2, y));
          return Math.hypot(x - cx, y - cy) < circle.width / 2 - 0.001;
        }
        return rectangleOverlap(pa, pb);
      }),
    );
  }
  function numberingSlots(parent) {
    const positions = slots(parent);
    if (parent.type === 'row' || parent.shape === 'round') return positions;
    const sides =
      parent.shape === 'l'
        ? ['top', 'right', 'inner-top', 'inner-left', 'bottom', 'left']
        : ['top', 'right', 'bottom', 'left'];
    return positions.sort((a, b) => {
      const [sideA, indexA] = a.slot.split(':');
      const [sideB, indexB] = b.slot.split(':');
      const sideOrder = sides.indexOf(sideA) - sides.indexOf(sideB);
      if (sideOrder) return sideOrder;
      const direction = ['bottom', 'left', 'inner-top'].includes(sideA)
        ? -1
        : 1;
      return (Number(indexA) - Number(indexB)) * direction;
    });
  }
  function renumber(objects) {
    const ordered = objects
      .filter((o) => ['table', 'row'].includes(o.type))
      .flatMap((parent) =>
        numberingSlots(parent).flatMap((slot) =>
          objects.filter(
            (o) =>
              o.type === 'seat' &&
              o.tableId === parent.id &&
              o.slot === slot.slot,
          ),
        ),
      );
    const rest = objects
      .filter((o) => o.type === 'seat' && !ordered.some((s) => s.id === o.id))
      .sort((a, b) => a.number - b.number);
    const numbers = new Map([...ordered, ...rest].map((o, i) => [o.id, i + 1]));
    return objects.map((o) =>
      o.type === 'seat' ? { ...o, number: numbers.get(o.id) } : o,
    );
  }
  function assertLayout(r, objects) {
    const furniture = objects.filter((o) => ['table', 'seat'].includes(o.type));
    if (
      objects.some(
        (o) =>
          !Number.isFinite(o.x) ||
          !Number.isFinite(o.y) ||
          !Number.isFinite(o.angle) ||
          !valid(r, o),
      )
    )
      throw Error('The whole item must fit inside the room.');
    for (const seat of furniture.filter((o) => o.type === 'seat')) {
      const table = objects.find(
        (o) => ['table', 'row'].includes(o.type) && o.id === seat.tableId,
      );
      const slot = table && slots(table).find((s) => s.slot === seat.slot);
      if (
        !slot ||
        Math.hypot(slot.x - seat.x, slot.y - seat.y) > 0.01 ||
        Math.abs(((slot.angle - seat.angle + 540) % 360) - 180) > 0.01
      )
        throw Error('Seats must use a fixed position around a table.');
    }
    for (let i = 0; i < furniture.length; i++)
      for (let j = i + 1; j < furniture.length; j++)
        if (overlaps(furniture[i], furniture[j]))
          throw Error('Seats and tables cannot overlap.');
  }
  function snapSeat(r, objects, seat, x, y) {
    const candidates = objects
      .filter((o) => ['table', 'row'].includes(o.type))
      .flatMap(slots)
      .map((s) => ({ ...s, distance: Math.hypot(s.x - x, s.y - y) }))
      .filter((s) => s.distance <= SNAP_DISTANCE)
      .sort((a, b) => a.distance - b.distance);
    for (const slot of candidates) {
      const next = { ...seat, ...slot };
      delete next.distance;
      if (!valid(r, next)) continue;
      if (
        objects.some(
          (o) =>
            o.id !== seat.id &&
            ['table', 'seat'].includes(o.type) &&
            overlaps(next, o),
        )
      )
        continue;
      return next;
    }
    throw Error(
      'Choose a free seat position near a table. Add or move a table if needed.',
    );
  }
  function remove(objects, id) {
    return renumber(objects.filter((o) => o.id !== id && o.tableId !== id));
  }

  function tableName(objects) {
    const used = new Set(
      objects
        .filter((o) => o.type === 'table')
        .map((o) =>
          String(o.label || '')
            .trim()
            .toUpperCase(),
        ),
    );
    for (let n = 1; ; n++) {
      let value = n,
        label = '';
      while (value) {
        value--;
        label = String.fromCharCode(65 + (value % 26)) + label;
        value = Math.floor(value / 26);
      }
      if (!used.has(label)) return label;
    }
  }

  const TABLE_SIZES = [24, 32, 80, 128, 176, 224, 272];
  const WALL_SIZES = [40, 70, 100, 140, 180, 220, 260, 300];
  function snapSize(value, sizes) {
    return sizes.reduce(
      (best, size) =>
        Math.abs(size - value) < Math.abs(best - value) - 0.000001
          ? size
          : best,
      sizes[0],
    );
  }
  const handles = {
    nw: [-1, -1],
    ne: [1, -1],
    sw: [-1, 1],
    se: [1, 1],
    w: [-1, 0],
    e: [1, 0],
  };
  function handlePoint(o, handle) {
    const signs = handles[handle];
    if (!signs) throw Error('Choose a resize handle.');
    o = actual(o);
    const x = (signs[0] * o.width) / 2,
      y = (signs[1] * o.height) / 2,
      a = (o.angle * Math.PI) / 180;
    return {
      x: o.x + x * Math.cos(a) - y * Math.sin(a),
      y: o.y + x * Math.sin(a) + y * Math.cos(a),
    };
  }
  function resize(r, objects, id, handle, x, y) {
    const old = objects.find((o) => o.id === id),
      signs = handles[handle];
    if (!old || !signs || !['table', 'window', 'door'].includes(old.type))
      throw Error('Select a resizable item.');
    const a = (old.angle * Math.PI) / 180,
      k = old.type === 'table' ? (old.scale ?? 1) : 1,
      dx = x - old.x,
      dy = y - old.y;
    const localX = dx * Math.cos(a) + dy * Math.sin(a),
      localY = -dx * Math.sin(a) + dy * Math.cos(a);
    const anchorX = (-signs[0] * old.width * k) / 2,
      anchorY = (-signs[1] * old.height * k) / 2;

    const sizes =
      old.type === 'table'
        ? old.shape === 'l'
          ? TABLE_SIZES.filter((s) => s >= 80)
          : TABLE_SIZES
        : WALL_SIZES;
    const width = snapSize((signs[0] * (localX - anchorX)) / k, sizes);
    let height =
      old.type === 'table'
        ? snapSize(
            (signs[1] * (localY - anchorY)) / k,
            old.shape === 'l'
              ? TABLE_SIZES.filter((s) => s >= 80)
              : TABLE_SIZES,
          )
        : old.height;
    if (old.shape === 'round') height = width;
    const cx = anchorX + (signs[0] * width * k) / 2,
      cy = old.type === 'table' ? anchorY + (signs[1] * height * k) / 2 : 0;
    return update(r, objects, id, {
      width,
      height,
      x: old.x + cx * Math.cos(a) - cy * Math.sin(a),
      y: old.y + cx * Math.sin(a) + cy * Math.cos(a),
    });
  }

  function resizeBy(r, objects, id, handle, dx, dy) {
    const o = objects.find((o) => o.id === id),
      signs = handles[handle];
    if (!o || !signs) throw Error('Choose a resize handle.');
    const a = (o.angle * Math.PI) / 180;
    const dw = signs[0] * (dx * Math.cos(a) + dy * Math.sin(a));
    const dh = signs[1] * (-dx * Math.sin(a) + dy * Math.cos(a));
    const next = (value, direction, sizes) =>
      direction > 0
        ? sizes.find((s) => s > value + 0.01) || sizes.at(-1)
        : direction < 0
          ? [...sizes].reverse().find((s) => s < value - 0.01) || sizes[0]
          : value;
    const width = next(
      o.width,
      Math.abs(dw) > 0.01 ? dw : 0,
      o.type === 'table' ? TABLE_SIZES : WALL_SIZES,
    );
    const height =
      o.type === 'table'
        ? next(o.height, Math.abs(dh) > 0.01 ? dh : 0, TABLE_SIZES)
        : o.height;
    const k = o.type === 'table' ? (o.scale ?? 1) : 1,
      p = handlePoint(o, handle),
      lx = signs[0] * (width - o.width) * k,
      ly = signs[1] * (height - o.height) * k;
    return resize(
      r,
      objects,
      id,
      handle,
      p.x + lx * Math.cos(a) - ly * Math.sin(a),
      p.y + lx * Math.sin(a) + ly * Math.cos(a),
    );
  }
  function normalize(r, objects) {
    for (const row of objects.filter(
      (o) => o.type === 'row' && o.seatSpacingVersion !== 2,
    )) {
      objects = update(r, objects, row.id, { seatSpacingVersion: 2 });
    }
    // Preserve seat identities and states, and correct numbering. Unplaceable legacy seats remain
    // visible for correction; Save rejects them rather than silently deleting them.
    const result = objects
      .filter((o) => o.type !== 'seat')
      .map((o) => ({ ...o }));
    for (const table of result.filter((o) => o.type === 'table'))
      if (!String(table.label || '').trim()) table.label = tableName(result);
    for (const seat of objects.filter((o) => o.type === 'seat')) {
      try {
        const parent = result.find((o) => o.id === seat.tableId);
        const slot = parent && slots(parent).find((s) => s.slot === seat.slot);
        result.push(
          slot
            ? { ...seat, ...slot }
            : snapSeat(r, result, seat, seat.x, seat.y),
        );
      } catch {
        result.push({ ...seat });
      }
    }
    return renumber(
      objects.map((o) => result.find((next) => next.id === o.id)),
    );
  }
  const SCALE_RANGE = [0.5, 2],
    SPACING_RANGE = [50, 300];
  // The furniture size of a layout, or undefined while it has no furniture.
  function layoutScale(objects) {
    const furniture = objects.find((o) => ['table', 'row'].includes(o.type));
    return furniture && (furniture.scale ?? 1);
  }
  // Resizes every table, seat row and seat around its own centre.
  function rescale(r, objects, scale) {
    if (
      !Number.isFinite(scale) ||
      scale < SCALE_RANGE[0] ||
      scale > SCALE_RANGE[1]
    )
      throw Error('Use a furniture size from 50 to 200%.');
    const parents = objects.map((o) =>
      ['table', 'row'].includes(o.type) ? { ...o, scale } : o,
    );
    const result = parents.map((o) => {
      if (o.type !== 'seat') return o;
      const parent = parents.find((p) => p.id === o.tableId);
      const slot = parent && slots(parent).find((s) => s.slot === o.slot);
      return slot ? { ...o, ...slot } : { ...o, scale };
    });
    try {
      assertLayout(r, result);
    } catch {
      throw Error(
        'Not enough space for this furniture size: items would overlap or leave the room.',
      );
    }
    return result;
  }
  function place(r, objects, type, x, y, id, scale = layoutScale(objects)) {
    if (
      ![
        'table',
        'seat',
        'window',
        'door',
        'round',
        'l',
        'row',
        'curved',
      ].includes(type)
    )
      throw Error('Choose a furniture tool.');
    let o = {
      id,
      type,
      x: Math.round(x / 4) * 4,
      y: Math.round(y / 4) * 4,
      angle: 0,
      width: type === 'table' ? 128 : type === 'seat' ? 32 : 70,
      height: type === 'table' ? 36 : 36,
    };

    if (['round', 'l'].includes(type)) {
      o.type = 'table';
      o.shape = type;
      o.width = 128;
      o.height = 128;
    }
    if (type === 'curved')
      Object.assign(o, {
        type: 'table',
        shape: 'curved',
        width: 176,
        height: 32,
        curvature: 60,
      });
    if (o.type === 'table') o.label = tableName(objects);
    if (['table', 'row'].includes(o.type) && scale && scale !== 1)
      o.scale = scale;
    if (type === 'row') {
      Object.assign(o, {
        seatSpacingVersion: 2,
        label: 'Row ' + (objects.filter((o) => o.type === 'row').length + 1),
        width: 272,
        height: 100,
        count: 6,
        rows: 2,
        sweep: 80,
        radius: 180,
      });
      return update(r, [...objects, o], id, { rows: 2 }, true);
    }
    if (type === 'seat') {
      o.number =
        Math.max(
          0,
          ...objects.filter((o) => o.type === 'seat').map((o) => o.number),
        ) + 1;
      o.state = 'free';
      o.active = true;
    }
    if (type === 'window' || type === 'door') {
      const wall = wallPoint(r, x, y, o.width);
      if (!wall) throw Error('No wall is long enough.');
      Object.assign(o, { x: wall.x, y: wall.y, angle: wall.angle });
    }
    if (type === 'seat') {
      o = snapSeat(r, objects, o, x, y);
      o.badges = [
        ...(objects.find((parent) => parent.id === o.tableId)?.badges || []),
      ];
    }
    const next = renumber([...objects, o]);
    assertLayout(r, next);
    return next;
  }
  function move(r, objects, id, x, y) {
    try {
      return update(r, objects, id, {
        x: Math.round(x / 4) * 4,
        y: Math.round(y / 4) * 4,
      });
    } catch {
      return objects;
    }
  }
  function update(r, objects, id, patch, initial = false) {
    const old = objects.find((o) => o.id === id);
    if (!old) throw Error('Select an item.');
    let next = { ...old, ...patch };
    if (
      next.type === 'seat' &&
      (!Number.isInteger(next.number) ||
        next.number < 1 ||
        next.number > 999 ||
        objects.some(
          (o) => o.id !== id && o.type === 'seat' && o.number === next.number,
        ))
    )
      throw Error('Use a unique seat number from 1 to 999.');
    if (
      !Number.isFinite(next.width) ||
      next.width < 24 ||
      next.width > 300 ||
      !Number.isFinite(next.height) ||
      next.height < 24 ||
      next.height > 300
    )
      throw Error('Use dimensions from 24 to 300.');
    if (next.type === 'door' || next.type === 'window') {
      const wall = wallPoint(r, next.x, next.y, next.width);
      if (!wall) throw Error('No wall is long enough for this size.');
      Object.assign(next, { x: wall.x, y: wall.y, angle: wall.angle });
    }

    if (next.type === 'seat') next = snapSeat(r, objects, next, next.x, next.y);

    if (next.type === 'table' && next.shape === 'curved') {
      next.curvature ??= 60;
      if (
        !Number.isFinite(next.curvature) ||
        next.curvature < 0 ||
        next.curvature > 100
      )
        throw Error('Use curvature from 0 to 100%.');
      if (
        next.curvature > 0 &&
        next.height / 2 >= next.width / ((2.8 * next.curvature) / 100)
      )
        throw Error(
          'Table is too deep for this curve. Reduce depth or curvature.',
        );
    }
    if (next.type === 'table' && next.shape === 'round')
      next.height = next.width;
    if (next.type === 'table' && next.shape === 'l') {
      next.width = Math.max(80, next.width);
      next.height = Math.max(80, next.height);
    }
    if (next.type === 'row') {
      next.seatSpacingVersion = 2;
      if (
        !Number.isInteger(next.count) ||
        next.count < 1 ||
        next.count > 12 ||
        !Number.isInteger(next.rows) ||
        next.rows < 1 ||
        next.rows > 6 ||
        !Number.isFinite(next.sweep) ||
        next.sweep < 0 ||
        next.sweep > 180 ||
        !Number.isFinite(next.radius) ||
        next.radius < 60 ||
        next.radius > 600
      )
        throw Error(
          'Use 1–12 seats, 1–6 rows, an arc of 0–180° and radius 60–600.',
        );
      for (const key of ['seatSpacing', 'rowSpacing'])
        if (
          next[key] !== undefined &&
          !(
            Number.isFinite(next[key]) &&
            next[key] >= SPACING_RANGE[0] &&
            next[key] <= SPACING_RANGE[1]
          )
        )
          throw Error('Use row and column spacing from 50 to 300%.');
    }
    const resized =
      (next.type === 'table' &&
        (old.width !== next.width ||
          old.height !== next.height ||
          old.curvature !== next.curvature ||
          (old.shape || 'rectangle') !== (next.shape || 'rectangle'))) ||
      (next.type === 'row' &&
        (initial ||
          old.seatSpacingVersion !== 2 ||
          [
            'count',
            'rows',
            'sweep',
            'radius',
            'seatSpacing',
            'rowSpacing',
          ].some((k) => old[k] !== next[k])));
    let result;
    if (resized) {
      const attached = objects.filter(
        (o) => o.type === 'seat' && o.tableId === id,
      );
      const ids = new Set(objects.map((o) => o.id));

      const oldSlots =
          old.type === 'row' && old.seatSpacingVersion !== 2
            ? rowSlots(old, true)
            : slots(old),
        newSlots = slots(next),
        chosen = [];

      if (next.type === 'row' && initial) chosen.push(...newSlots);
      else if (next.type === 'row') {
        for (let row = 0; row < next.rows; row++) {
          const after = newSlots.filter((s) =>
            s.slot.startsWith('row' + row + ':'),
          );
          if (row >= old.rows) {
            chosen.push(...after);
            continue;
          }
          const existing = attached.filter((s) =>
            s.slot.startsWith('row' + row + ':'),
          );
          if (!existing.length) continue;
          const before = oldSlots.filter((s) =>
            s.slot.startsWith('row' + row + ':'),
          );
          const delta = after.length - before.length,
            shift =
              delta >= 0 ? Math.floor(delta / 2) : -Math.floor(-delta / 2);
          for (const seat of existing) {
            const i = Number(seat.slot.split(':')[1]) + shift;
            if (after[i]) chosen.push({ ...after[i], existing: seat });
          }
          if (delta > 0)
            for (let i = 0; i < after.length; i++)
              if (i < shift || i >= shift + before.length)
                chosen.push(after[i]);
        }
      } else if (old.shape !== next.shape)
        chosen.push(
          ...newSlots
            .slice(0, attached.length)
            .map((slot, i) => ({ ...slot, existing: attached[i] })),
        );
      else
        for (const side of new Set(oldSlots.map((s) => s.slot.split(':')[0]))) {
          const existing = attached.filter(
            (o) => o.slot.split(':')[0] === side,
          );
          if (!existing.length) continue;
          const before = oldSlots.filter((s) => s.slot.startsWith(side + ':'));
          const after = newSlots.filter((s) => s.slot.startsWith(side + ':'));
          const delta = after.length - before.length;
          const shift =
            delta >= 0 ? Math.floor(delta / 2) : -Math.floor(-delta / 2);
          for (const seat of existing) {
            const index =
              before.findIndex((slot) => slot.slot === seat.slot) + shift;
            if (after[index]) chosen.push({ ...after[index], existing: seat });
          }
          if (delta > 0)
            for (let i = 0; i < after.length; i++)
              if (i < shift || i >= shift + before.length)
                chosen.push(after[i]);
        }
      const seats = chosen.map((slot) => {
        const existing = slot.existing;
        const position = { ...slot };
        delete position.existing;
        if (existing) return { ...existing, ...position };
        const base = id + '-seat-' + slot.slot.replace(':', '-');
        let seatId = base,
          suffix = 1;
        while (ids.has(seatId)) seatId = base + '-' + suffix++;
        ids.add(seatId);
        return {
          id: seatId,
          type: 'seat',
          width: 32,
          height: 36,
          number: 0,
          badges: [...(next.badges || [])],
          state: 'free',
          active: true,
          ...position,
        };
      });
      result = objects
        .filter((o) => !(o.type === 'seat' && o.tableId === id))
        .map((o) => (o.id === id ? next : o));
      result.push(...seats);
      result = renumber(result);
    } else {
      result = objects.map((o) => {
        if (o.id === id) return next;
        if (
          ['table', 'row'].includes(next.type) &&
          o.type === 'seat' &&
          o.tableId === id
        )
          return { ...o, ...slots(next).find((s) => s.slot === o.slot) };
        return o;
      });
    }
    result = renumber(result);
    assertLayout(r, result);
    return result;
  }
  const BADGES = {
    outlet: 'Power outlet',
    monitor: 'Monitor',
    quiet: 'Quiet area',
  };
  function toggleBadge(objects, id, badge) {
    if (!Object.hasOwn(BADGES, badge))
      throw Error('Choose a supported seat feature.');
    const target = objects.find(
      (o) => o.id === id && ['seat', 'table'].includes(o.type),
    );
    if (!target) throw Error('Click a seat or table to change its feature.');
    const enabled = !(target.badges || []).includes(badge);
    return objects.map((o) => {
      if (
        o.id !== id &&
        !(target.type === 'table' && o.type === 'seat' && o.tableId === id)
      )
        return o;
      const badges = Array.isArray(o.badges) ? o.badges : [];
      return {
        ...o,
        badges: enabled
          ? [...new Set([...badges, badge])]
          : badges.filter((b) => b !== badge),
      };
    });
  }

  const api = {
    curveOutline,
    curvePoints,
    BADGES,
    toggleBadge,
    UNITS_PER_METER,
    roomFromCoordinates,
    sourcePoint,
    renumber,
    rowSlots,
    rowMetrics,
    layoutScale,
    rescale,
    SCALE_RANGE,
    SPACING_RANGE,
    shapeParts,
    TABLE_SIZES,
    WALL_SIZES,
    snapSize,
    tableName,
    handlePoint,
    resize,
    resizeBy,
    SEAT_GAP,
    SEAT_PITCH,
    slots,
    overlaps,
    assertLayout,
    normalize,
    remove,
    rooms,
    room,
    clone,
    contains,
    wallPoint,
    valid,
    place,
    move,
    update,
  };
  return api;
})();
export default geometry;
