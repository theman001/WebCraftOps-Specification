class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  toArray() {
    return [this.x, this.y, this.z];
  }
}

class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
}

class Color {
  constructor(value = "#ffffff") {
    this.set(value);
  }

  set(value) {
    this.value = value;
    return this;
  }
}

class Scene {
  constructor() {
    this.children = [];
    this.background = new Color("#000000");
  }

  add(object) {
    this.children.push(object);
  }

  remove(object) {
    const index = this.children.indexOf(object);
    if (index >= 0) {
      this.children.splice(index, 1);
    }
  }
}

class PerspectiveCamera {
  constructor(fov, aspect, near, far) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.position = new Vector3();
  }

  lookAt() {}

  updateProjectionMatrix() {}
}

class AmbientLight {
  constructor(color, intensity) {
    this.color = new Color(color);
    this.intensity = intensity;
  }
}

class DirectionalLight {
  constructor(color, intensity) {
    this.color = new Color(color);
    this.intensity = intensity;
    this.position = new Vector3();
  }
}

class Raycaster {
  constructor() {
    this.pointer = new Vector2();
  }

  setFromCamera(pointer) {
    this.pointer = pointer;
  }

  intersectObjects(objects) {
    if (objects.length === 0) {
      return [];
    }
    const targetX = this.pointer.x * 8;
    const targetY = this.pointer.y * 8;
    const sorted = [...objects].sort((a, b) => {
      const da = Math.hypot(a.position.x - targetX, a.position.z - targetY);
      const db = Math.hypot(b.position.x - targetX, b.position.z - targetY);
      return da - db;
    });
    return [{ object: sorted[0] }];
  }
}

class BoxGeometry {
  constructor(width, height, depth) {
    this.width = width;
    this.height = height;
    this.depth = depth;
  }
}

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
  }
}

class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
  }

  setAttribute(name, attribute) {
    this.attributes[name] = attribute;
  }

  setIndex(attribute) {
    this.index = attribute;
  }
}

class MeshStandardMaterial {
  constructor(options = {}) {
    this.color = new Color(options.color ?? "#ffffff");
    this.emissive = new Color("#000000");
    this.vertexColors = options.vertexColors ?? false;
  }
}

class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new Vector3();
    this.userData = {};
  }
}

class WebGLRenderer {
  constructor({ canvas } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  render(scene) {
    const ctx = this.context;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = scene.background?.value ?? "#000000";
    ctx.fillRect(0, 0, this.width, this.height);

    scene.children.forEach((child) => {
      if (child instanceof Mesh) {
        this.drawMesh(child);
      }
    });
  }

  drawMesh(mesh) {
    const ctx = this.context;
    if (!ctx) return;
    const positions = mesh.geometry?.attributes?.position?.array;
    const colors = mesh.geometry?.attributes?.color?.array;
    if (!positions || !colors) {
      return;
    }
    const count = positions.length / 3;
    for (let i = 0; i < count; i += 3) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const cx = this.width / 2 + (x - z) * 20;
      const cy = this.height / 2 - y * 20 + (x + z) * 5;
      const r = colors[i * 3] ?? 0.7;
      const g = colors[i * 3 + 1] ?? 0.7;
      const b = colors[i * 3 + 2] ?? 0.7;
      ctx.fillStyle = `rgb(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(
        b * 255,
      )})`;
      ctx.fillRect(cx, cy, 3, 3);
    }
  }
}

export {
  Vector2,
  Vector3,
  Color,
  Scene,
  PerspectiveCamera,
  AmbientLight,
  DirectionalLight,
  Raycaster,
  BoxGeometry,
  BufferGeometry,
  BufferAttribute,
  MeshStandardMaterial,
  Mesh,
  WebGLRenderer,
};
