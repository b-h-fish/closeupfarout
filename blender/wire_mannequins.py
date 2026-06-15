"""
Wire Mannequin Generator — closeupfarout.com
Blender 4.2 | Run via Scripting workspace

INSTRUCTIONS:
  1. Open the Scripting workspace (tab at the top of Blender)
  2. Click New to create a blank script
  3. Paste this entire file
  4. Press Alt+P or click the ▶ Run Script button
  5. Check the 3D viewport on the left
"""

import bpy
import math

# ── SETTINGS ─────────────────────────────────────────────────────────────────
WIRE_THICKNESS   = 0.008   # thickness of the wire tubes
COLOR_A          = (0.2, 0.9, 1.0, 1.0)   # cyan  — Fighter A
COLOR_B          = (1.0, 0.3, 0.2, 1.0)   # red   — Fighter B
EMISSION_STRENGTH = 2.5


# ── HELPERS ───────────────────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)


def make_material(name, color):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    emit = nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value    = color
    emit.inputs['Strength'].default_value = EMISSION_STRENGTH

    out = nodes.new('ShaderNodeOutputMaterial')
    links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


def add_part(name, shape, loc, rot=(0, 0, 0), dims=(1, 1, 1)):
    """
    Create one body-part mesh.
    shape: 'sphere' | 'cylinder' | 'box'
    dims:
      sphere   → (radius, -, -)
      cylinder → (radius, height, -)
      box      → (x, y, z) half-dimensions
    """
    if shape == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=dims[0], location=loc, rotation=rot,
            segments=8, ring_count=5
        )
    elif shape == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(
            radius=dims[0], depth=dims[1], location=loc, rotation=rot,
            vertices=8
        )
    elif shape == 'box':
        bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
        obj = bpy.context.active_object
        obj.scale = dims
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(scale=True)
        obj.name = name
        return obj

    obj = bpy.context.active_object
    obj.name = name
    return obj


def add_wireframe(obj):
    wf = obj.modifiers.new(name='Wireframe', type='WIREFRAME')
    wf.thickness      = WIRE_THICKNESS
    wf.use_replace    = True
    wf.use_boundary   = False
    return wf


def assign_material(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


# ── MANNEQUIN BUILDER ─────────────────────────────────────────────────────────

def build_mannequin(prefix, mat, pose):
    """
    Build a full wire mannequin.
    pose: dict of body-part overrides — keys match the part names below,
          values are (location, rotation) tuples relative to the root.
    Returns the root Empty that parents everything.
    """

    # Default neutral T-pose part definitions
    # (location_xyz, shape, dims, rotation_xyz_degrees)
    defaults = {
        'head':         ((0,    0,  1.65), 'sphere',   (0.115, 0, 0),  (0, 0, 0)),
        'neck':         ((0,    0,  1.47), 'cylinder', (0.05, 0.13,0), (0, 0, 0)),
        'torso':        ((0,    0,  1.12), 'box',      (0.19, 0.12, 0.27), (0, 0, 0)),
        'hips':         ((0,    0,  0.83), 'box',      (0.16, 0.11, 0.13), (0, 0, 0)),
        'upper_arm_L':  ((-0.27, 0, 1.25), 'cylinder', (0.04, 0.27, 0), (0, 0, math.radians(-15))),
        'upper_arm_R':  (( 0.27, 0, 1.25), 'cylinder', (0.04, 0.27, 0), (0, 0, math.radians( 15))),
        'lower_arm_L':  ((-0.38, 0, 1.07), 'cylinder', (0.033, 0.25, 0),(0, 0, math.radians(-30))),
        'lower_arm_R':  (( 0.38, 0, 1.07), 'cylinder', (0.033, 0.25, 0),(0, 0, math.radians( 30))),
        'hand_L':       ((-0.46, 0, 0.94), 'sphere',   (0.05, 0, 0),   (0, 0, 0)),
        'hand_R':       (( 0.46, 0, 0.94), 'sphere',   (0.05, 0, 0),   (0, 0, 0)),
        'upper_leg_L':  ((-0.11, 0, 0.57), 'cylinder', (0.06, 0.40, 0),(0, 0, math.radians( 5))),
        'upper_leg_R':  (( 0.11, 0, 0.57), 'cylinder', (0.06, 0.40, 0),(0, 0, math.radians(-5))),
        'lower_leg_L':  ((-0.11, 0, 0.18), 'cylinder', (0.05, 0.37, 0),(0, 0, 0)),
        'lower_leg_R':  (( 0.11, 0, 0.18), 'cylinder', (0.05, 0.37, 0),(0, 0, 0)),
        'foot_L':       ((-0.11,-0.08,0.04),'box',     (0.07, 0.13, 0.04),(0, 0, 0)),
        'foot_R':       (( 0.11,-0.08,0.04),'box',     (0.07, 0.13, 0.04),(0, 0, 0)),
    }

    # Merge pose overrides
    parts_def = {**defaults, **pose}

    # Root empty
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = f'{prefix}_root'

    # Build each part
    for key, (loc, shape, dims, rot) in parts_def.items():
        obj = add_part(f'{prefix}_{key}', shape, loc, rot=rot, dims=dims)
        add_wireframe(obj)
        assign_material(obj, mat)
        obj.parent = root
        obj.matrix_parent_inverse = root.matrix_world.inverted()

    return root


# ── FIGHT POSES ───────────────────────────────────────────────────────────────

# Fighter A — orthodox guard, right cross loading
pose_A = {
    # Left arm extended (jab out)
    'upper_arm_L':  ((-0.30, -0.10, 1.25), 'cylinder', (0.04, 0.27, 0),
                     (math.radians(-10), math.radians(-15), math.radians(-80))),
    'lower_arm_L':  ((-0.44, -0.28, 1.22), 'cylinder', (0.033, 0.25, 0),
                     (math.radians(-5),  math.radians(-20), math.radians(-80))),
    'hand_L':       ((-0.50, -0.42, 1.20), 'sphere',   (0.05, 0, 0),   (0, 0, 0)),
    # Right arm cocked back
    'upper_arm_R':  (( 0.22,  0.08, 1.28), 'cylinder', (0.04, 0.27, 0),
                     (math.radians(20),  math.radians(10),  math.radians(30))),
    'lower_arm_R':  (( 0.28,  0.18, 1.22), 'cylinder', (0.033, 0.25, 0),
                     (math.radians(30),  math.radians(10),  math.radians(50))),
    'hand_R':       (( 0.30,  0.22, 1.15), 'sphere',   (0.05, 0, 0),   (0, 0, 0)),
    # Staggered stance — left foot forward
    'upper_leg_L':  ((-0.12,  0.06, 0.57), 'cylinder', (0.06, 0.40, 0),
                     (math.radians(5), 0, math.radians(5))),
    'upper_leg_R':  (( 0.12, -0.06, 0.57), 'cylinder', (0.06, 0.40, 0),
                     (math.radians(-5), 0, math.radians(-5))),
    'foot_L':       ((-0.12,  0.04, 0.04), 'box',      (0.07, 0.13, 0.04), (0, 0, 0)),
    'foot_R':       (( 0.12, -0.10, 0.04), 'box',      (0.07, 0.13, 0.04), (0, 0, 0)),
}

# Fighter B — slipping the jab, counter right loading
pose_B = {
    # Head slipping left (ducked slightly)
    'head':  ((0.06, 0, 1.58), 'sphere', (0.115, 0, 0), (math.radians(-8), 0, math.radians(15))),
    # Both arms in tight guard
    'upper_arm_L': ((-0.22, 0, 1.30), 'cylinder', (0.04, 0.27, 0),
                    (0, 0, math.radians(-70))),
    'lower_arm_L': ((-0.22, 0, 1.12), 'cylinder', (0.033, 0.25, 0),
                    (0, 0, math.radians(-80))),
    'hand_L':      ((-0.22, 0, 0.96), 'sphere',   (0.05, 0, 0),   (0, 0, 0)),
    'upper_arm_R': (( 0.18, 0, 1.30), 'cylinder', (0.04, 0.27, 0),
                    (0, 0, math.radians( 70))),
    'lower_arm_R': (( 0.18, 0, 1.12), 'cylinder', (0.033, 0.25, 0),
                    (0, 0, math.radians( 80))),
    'hand_R':      (( 0.18, 0, 0.96), 'sphere',   (0.05, 0, 0),   (0, 0, 0)),
}


# ── BUILD THE SCENE ───────────────────────────────────────────────────────────

clear_scene()

mat_A = make_material('wire_cyan', COLOR_A)
mat_B = make_material('wire_red',  COLOR_B)

root_A = build_mannequin('A', mat_A, pose_A)
root_B = build_mannequin('B', mat_B, pose_B)

# Position fighters facing each other
root_A.location = (-0.55, 0, 0)
root_B.location = ( 0.55, 0, 0)
root_B.rotation_euler.z = math.radians(180)   # face left

# ── CAMERA ───────────────────────────────────────────────────────────────────

bpy.ops.object.camera_add(location=(0, -3.2, 1.1))
cam = bpy.context.active_object
cam.rotation_euler = (math.radians(88), 0, 0)
bpy.context.scene.camera = cam

# ── LIGHTING ─────────────────────────────────────────────────────────────────

# Key light
bpy.ops.object.light_add(type='AREA', location=(1.5, -2, 3))
key = bpy.context.active_object
key.data.energy = 200
key.data.size   = 2.0
key.rotation_euler = (math.radians(55), 0, math.radians(30))

# Fill light (opposite side, dimmer)
bpy.ops.object.light_add(type='AREA', location=(-2, -1, 2))
fill = bpy.context.active_object
fill.data.energy = 80
fill.data.size   = 3.0

# ── RENDER SETTINGS ───────────────────────────────────────────────────────────

scene = bpy.context.scene
scene.render.engine             = 'CYCLES'
scene.render.film_transparent   = True   # transparent background → PNG/WebM w/ alpha
scene.cycles.samples            = 64
scene.render.resolution_x       = 1080
scene.render.resolution_y       = 1080

# Dark world (so the glowing wire pops)
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.02, 0.02, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.1

print("✓ Wire mannequins built. Press Numpad 0 to see through camera.")
print("  Next: File → Render → Render Image to preview.")
