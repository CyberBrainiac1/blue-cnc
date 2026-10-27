FeatureScript 3095;
import(path : "onshape/std/common.fs", version : "3095.0");

// Frame-mounted limit-switch brackets for the 6040 model. Same numbers as frame_mounts.py
// (CadQuery, which makes the print STLs). Coordinates are the 6040CNC Part Studio frame, mm.
// Hardware: M3 hex-head bolts, M4 socket-head screws and nyloc nuts trapped in the brackets.

const GAP = 0.2;
const SNUG = 0.1;     // switch pocket clearance per end (the pins do the tight locating)
const PIN_D = 2.30;   // printed pin, snug in the switch's 2.35 mm hole
const PIN_HOLE = 2.45;    // blind hole in the bracket (prints ~0.15 small -> press fit)
const PIN_ACCESS = 2.6;   // hole the pin is pushed in through
const PIN_LEN = 18.6;
// locating features on round parts of the machine (tight: 0.1 per side)
const X_ROD_Y = 281.19; const X_ROD_Z = 327.61;  // upper 20 mm X rod end, against the right side plate
const X_ROD_R = 10.0 + 0.1;
const ROD_X0 = 2.0;                              // cradle's inner face (right-side frame)
// The X bracket goes on the LEFT gantry side plate (homes to -X). It is drawn in the right-side
// frame and mirrored about x = X_MIRROR, 0.19 mm higher (the model is very slightly tilted).
const X_MIRROR = -241.76; const X_LEFT_DZ = 0.19;
const SWX = -4.5;                                // switch 4.5 mm toward the carriage: trips at about -62, about 6 mm
                                                 // before the carriage's lower plate reaches the left side plate (-69.4)
const Z_HEAD_X = -324.28; const Z_HEAD_Y = 228.19;  // M5 socket head holding the top of the Z rod
const Z_HEAD_R = 4.25 + 0.1;

// KW11 / SS-5GL switch, lever cut to 16.5 mm
const SW_L = 19.8;
const SW_H = 10.2;
const SW_T = 6.4;
const HOLE_D = 2.35;
const HOLE_SP = 9.5;
const HOLE_Y = 2.9;
const LEVER_LEN = 16.5;
const FP_ABOVE_HOLES = 13.0;
const SNUG_HALF = SW_L / 2 + SNUG;

function vec3(x, y, z) { return vector(x, y, z); }

function bx(context is Context, id is Id, x0, x1, y0, y1, z0, z1)
{
    fCuboid(context, id, { "corner1" : vec3(min(x0, x1), min(y0, y1), min(z0, z1)) * millimeter,
                "corner2" : vec3(max(x0, x1), max(y0, y1), max(z0, z1)) * millimeter });
}

function cy(context is Context, id is Id, c is Vector, axis is Vector, start, length, dia)
{
    fCylinder(context, id, { "bottomCenter" : (c + axis * start) * millimeter,
                "topCenter" : (c + axis * (start + length)) * millimeter,
                "radius" : dia / 2 * millimeter });
}

// Switch frame: face = centre of the lever face, n = lever-facing direction, a = length axis
function switchFrame(face is Vector, n is Vector, a is Vector) returns map
{
    const t = cross(a, n);
    const origin = face - n * SW_H;
    return { "origin" : origin, "n" : n, "a" : a, "t" : t,
            "holes" : [origin - a * (HOLE_SP / 2) + n * HOLE_Y, origin + a * (HOLE_SP / 2) + n * HOLE_Y] };
}

function makeSwitch(context is Context, id is Id, f is map, name is string)
{
    // body in switch-local coords: x = length, y = 0 terminal edge .. SW_H lever face, z = thickness
    bx(context, id + "body", -SW_L / 2, SW_L / 2, 0, SW_H, -SW_T / 2, SW_T / 2);
    for (var i = 0; i < 2; i += 1)
        cy(context, id + ("h" ~ i), vec3((i * 2 - 1) * HOLE_SP / 2, HOLE_Y, -SW_T), vec3(0, 0, 1), 0, 2 * SW_T, HOLE_D);
    opBoolean(context, id + "hb", { "tools" : qUnion([qCreatedBy(id + "h0", EntityType.BODY), qCreatedBy(id + "h1", EntityType.BODY)]),
                "targets" : qCreatedBy(id + "body", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    var k = 0;
    for (var x in [-7.9, 0.8, 7.8])
    {
        bx(context, id + ("t" ~ k), x - 0.25, x + 0.25, -3.6, 0, -1.6, 1.6);
        k += 1;
    }
    opBoolean(context, id + "tu", { "tools" : qUnion([qCreatedBy(id + "body", EntityType.BODY), qCreatedBy(id + "t0", EntityType.BODY),
                        qCreatedBy(id + "t1", EntityType.BODY), qCreatedBy(id + "t2", EntityType.BODY)]),
                "operationType" : BooleanOperationType.UNION });
    // lever (free position), separate body so it can be ignored in clash checks
    const tipY = HOLE_Y + FP_ABOVE_HOLES;
    const px = -SW_L / 2 + 1.2;
    const py = SW_H + 0.4;
    const ang = atan2((tipY - py) * millimeter, LEVER_LEN * millimeter);
    bx(context, id + "lever", 0, LEVER_LEN, -0.175, 0.175, -2, 2);
    opTransform(context, id + "lr", { "bodies" : qCreatedBy(id + "lever", EntityType.BODY),
                "transform" : transform(vec3(px, py, 0) * millimeter) * rotationAround(line(vector(0, 0, 0) * meter, vector(0, 0, 1)), ang) });
    const cs = coordSystem(f.origin * millimeter, f.a, f.t);
    opTransform(context, id + "place", { "bodies" : qUnion([qCreatedBy(id + "body", EntityType.BODY), qCreatedBy(id + "t0", EntityType.BODY),
                        qCreatedBy(id + "t1", EntityType.BODY), qCreatedBy(id + "t2", EntityType.BODY), qCreatedBy(id + "lever", EntityType.BODY)]),
                "transform" : toWorld(cs) });
    setProperty(context, { "entities" : qCreatedBy(id + "body", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : "switch_" ~ name });
    setProperty(context, { "entities" : qCreatedBy(id + "lever", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : "lever_" ~ name });
    setProperty(context, { "entities" : qCreatedBy(id + "body", EntityType.BODY), "propertyType" : PropertyType.APPEARANCE, "value" : color(0.12, 0.12, 0.12) });
    setProperty(context, { "entities" : qCreatedBy(id + "lever", EntityType.BODY), "propertyType" : PropertyType.APPEARANCE, "value" : color(0.75, 0.75, 0.78) });
}

// adds / cuts are arrays of functions(context, id) building one tool body each
function makeMount(context is Context, id is Id, adds is array, cuts is array, name is string)
{
    var addQ = [];
    for (var i = 0; i < size(adds); i += 1)
    {
        adds[i](context, id + ("a" ~ i));
        addQ = append(addQ, qCreatedBy(id + ("a" ~ i), EntityType.BODY));
    }
    if (size(addQ) > 1)
        opBoolean(context, id + "u", { "tools" : qUnion(addQ), "operationType" : BooleanOperationType.UNION });
    var cutQ = [];
    for (var i = 0; i < size(cuts); i += 1)
    {
        cuts[i](context, id + ("c" ~ i));
        cutQ = append(cutQ, qCreatedBy(id + ("c" ~ i), EntityType.BODY));
    }
    opBoolean(context, id + "s", { "tools" : qUnion(cutQ), "targets" : qUnion(addQ), "operationType" : BooleanOperationType.SUBTRACTION });
    setProperty(context, { "entities" : qUnion(addQ), "propertyType" : PropertyType.NAME, "value" : "mount_" ~ name });
    setProperty(context, { "entities" : qUnion(addQ), "propertyType" : PropertyType.APPEARANCE, "value" : color(1.0, 0.45, 0.0) });
}

// Hex prism (flats parallel to flatDir) centred on c, h long along axis
function hexPrism(context is Context, id is Id, c is Vector, axis is Vector, flatDir is Vector, af, h)
{
    const sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane((c - axis * (h / 2)) * millimeter, axis, flatDir) });
    skRegularPolygon(sk, "hex", { "center" : vector(0, 0) * millimeter, "firstVertex" : vector(af / 2 / cos(30 * degree), 0) * millimeter, "sides" : 6 });
    skSolve(sk);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "sk"), "direction" : axis,
                "endBound" : BoundingType.BLIND, "endDepth" : h * millimeter });
    opDeleteBodies(context, id + "del", { "entities" : qCreatedBy(id + "sk", EntityType.BODY) });
}

// Nut trap: hex pocket plus a slot of width af running slotLen along slotDir so the nut can
// be pushed in from outside. Axis-aligned only.
function nutTrap(context is Context, id is Id, c is Vector, axis is Vector, slotDir is Vector, af, h, slotLen)
{
    hexPrism(context, id + "hex", c, axis, slotDir, af, h);
    const w = cross(axis, slotDir);
    const p1 = c - axis * (h / 2) - w * (af / 2);
    const p2 = c + axis * (h / 2) + w * (af / 2) + slotDir * slotLen;
    bx(context, id + "slot", p1[0], p2[0], p1[1], p2[1], p1[2], p2[2]);
}

const M3_CLEAR = 3.4;
const M3_NUT_AF = 5.8;
const M3_NUT_H = 4.3;
const M4_CLEAR = 4.5;
const M4_NUT_AF = 7.3;
const M4_NUT_H = 5.3;

function mountX(context is Context, id is Id, showSwitches is boolean)
{
    // ---- X: saddle on the top edge of the gantry side plate, drawn on the right and mirrored to the left
        const y0 = 260.5; const y1 = 291.9; const ym = (y0 + y1) / 2;
        const xIn = 11.19; const xOut = 23.29; const zTop = 347.61;
        const f = switchFrame(vec3(9.5 + SWX, ym, 360.2 + SW_T / 2), vec3(-1, 0, 0), vec3(0, 1, 0));
        makeMount(context, id + "X", [
                    function(c, i) { bx(c, i, ROD_X0, 26.6, y0, y1, zTop, 350.6); },
                    function(c, i) { bx(c, i, 9.0, xIn - GAP, y0, y1, 343.6, zTop); },
                    function(c, i) { bx(c, i, xOut + GAP, 26.6, y0, y1, 330.0, zTop); },
                    function(c, i) { bx(c, i, 26.6, 32.0, y0, y1, 330.0, 345.0); },
                    function(c, i) { bx(c, i, 9.5 + SWX, 20.0 + SWX, y0, y1, 350.6, 360.2); },
                    function(c, i) { bx(c, i, 9.5 + SWX, 21.5 + SWX, y0, ym - SNUG_HALF, 360.2, 374.8); },
                    function(c, i) { bx(c, i, 9.5 + SWX, 21.5 + SWX, ym + SNUG_HALF, y1, 360.2, 374.8); },
                    function(c, i) { bx(c, i, 10.0 + SWX, 21.5 + SWX, y0, y1, 366.8, 374.8); },
                    // rod cradle over the end of the upper X rod (top and front side, back cut at 45 deg)
                    function(c, i) { bx(c, i, ROD_X0, xIn - GAP, y0, y1, X_ROD_Z, zTop); },
                    function(c, i) { bx(c, i, ROD_X0, xIn - GAP, y0, X_ROD_Y - X_ROD_R, X_ROD_Z - 6.0, X_ROD_Z); }],
                [function(c, i) { cy(c, i, vec3(ROD_X0 - 0.5, X_ROD_Y, X_ROD_Z), vec3(1, 0, 0), 0, 12.0, 2 * X_ROD_R); },
                    function(c, i) { bx(c, i, ROD_X0 - 0.5, xIn, X_ROD_Y, y1 + 0.5, X_ROD_Z - 7.0, X_ROD_Z + 7.2); },
                    function(c, i) { cy(c, i, vec3(xOut + GAP, ym, 337.5), vec3(1, 0, 0), 0, 9.0, M4_CLEAR); },
                    function(c, i) { nutTrap(c, i, vec3(27.15, ym, 337.5), vec3(1, 0, 0), vec3(0, 0, -1), M4_NUT_AF, M4_NUT_H, 8.0); },
                    function(c, i) { cy(c, i, vec3(13.0 + SWX, ym, 366.8), vec3(0, 0, 1), 0, 8.5, M3_CLEAR); },
                    function(c, i) { nutTrap(c, i, vec3(13.0 + SWX, ym, 370.0), vec3(0, 0, 1), vec3(-1, 0, 0), M3_NUT_AF, M3_NUT_H, 6.0); },
                    function(c, i) { cy(c, i, vec3(f.holes[0][0], f.holes[0][1], 366.6), vec3(0, 0, 1), 0, 8.5, PIN_ACCESS); },
                    function(c, i) { cy(c, i, vec3(f.holes[1][0], f.holes[1][1], 366.6), vec3(0, 0, 1), 0, 8.5, PIN_ACCESS); },
                    function(c, i) { cy(c, i, vec3(f.holes[0][0], f.holes[0][1], 360.2), vec3(0, 0, -1), 0, 4.0, PIN_HOLE); },
                    function(c, i) { cy(c, i, vec3(f.holes[1][0], f.holes[1][1], 360.2), vec3(0, 0, -1), 0, 4.0, PIN_HOLE); }], "X");
        if (showSwitches)
            makeSwitch(context, id + "swX", f, "X");
}

function mountY(context is Context, id is Id, showSwitches is boolean)
{
    // ---- Y: tongue in the T-slot on the side of the table's right-hand edge (x -2.72), slid in from
    // the back end of the table until a tab under the table stops on the back end plate. One M4 x 12
    // through a trapped nyloc pushes on the table side, pulling the tongue against the slot lips.
        const y0 = 317.0; const y1 = 348.99; const yp = 333.0;   // lever face, table back end, pocket end
        const zc = 81.0; const zb = 68.6;
        const yl = 340.0; const zl = 94.7;                         // M4 lock screw
        const f = switchFrame(vec3(14.0 + SW_T / 2, y0, zc), vec3(0, -1, 0), vec3(0, 0, 1));
        makeMount(context, id + "Y", [
                    function(c, i) { bx(c, i, -2.52, 7.0, y0, y1, 82.07, 99.5); },
                    function(c, i) { bx(c, i, -1.62, 7.0, y0, y1, zb, 82.07); },
                    function(c, i) { bx(c, i, -6.0, -1.62, 339.19, y1, 70.0, 81.67); },
                    function(c, i) { bx(c, i, -9.29, -5.02, y0, y1, 84.27, 94.57); },
                    function(c, i) { bx(c, i, -5.02, -2.52, y0, y1, 86.57, 92.17); },
                    function(c, i) { bx(c, i, 7.0, 14.0, y0, yp, zb, 94.0); },
                    function(c, i) { bx(c, i, 20.6, 28.6, y0, yp, zb, 94.0); },
                    function(c, i) { bx(c, i, 14.0, 20.6, y0, yp, zb, zc - SNUG_HALF); },
                    function(c, i) { bx(c, i, 14.0, 20.6, y0, yp, zc + SNUG_HALF, 94.0); }],
                [function(c, i) { cy(c, i, vec3(-2.72, yl, zl), vec3(1, 0, 0), -0.5, 10.5, M4_CLEAR); },
                    function(c, i) { nutTrap(c, i, vec3(2.6, yl, zl), vec3(1, 0, 0), vec3(0, 1, 0), M4_NUT_AF, M4_NUT_H, y1 - yl + 1.0); },
                    function(c, i) { cy(c, i, vec3(20.6, 320.3, zc), vec3(1, 0, 0), 0, 8.5, M3_CLEAR); },
                    function(c, i) { nutTrap(c, i, vec3(23.9, 320.3, zc), vec3(1, 0, 0), vec3(0, -1, 0), M3_NUT_AF, M3_NUT_H, 6.0); },
                    function(c, i) { cy(c, i, vec3(20.4, f.holes[0][1], f.holes[0][2]), vec3(1, 0, 0), 0, 8.5, PIN_ACCESS); },
                    function(c, i) { cy(c, i, vec3(20.4, f.holes[1][1], f.holes[1][2]), vec3(1, 0, 0), 0, 8.5, PIN_ACCESS); },
                    function(c, i) { cy(c, i, vec3(14.0, f.holes[0][1], f.holes[0][2]), vec3(-1, 0, 0), 0, 4.0, PIN_HOLE); },
                    function(c, i) { cy(c, i, vec3(14.0, f.holes[1][1], f.holes[1][2]), vec3(-1, 0, 0), 0, 4.0, PIN_HOLE); }], "Y");
        if (showSwitches)
            makeSwitch(context, id + "swY", f, "Y");
}

function mountZ(context is Context, id is Id, showSwitches is boolean)
{
    // ---- Z: clip on the right edge of the Z top plate, switch over the spindle holder clamp ear
        const xRight = -305.28; const zShelf = 369.74; const zBottom = 360.73;
        const c0 = 248.6; const c1 = 259.0; const yf = 140.6; const zT = 380.0;
        const f = switchFrame(vec3(-308.8, 153.0, 359.5), vec3(0, 0, -1), vec3(0, 1, 0));
        makeMount(context, id + "Z", [
                    function(c, i) { bx(c, i, -316.4, xRight + GAP, yf, c1, zShelf + GAP, zT); },
                    function(c, i) { bx(c, i, xRight + GAP, -301.0, yf, c1, 357.5, zT); },
                    function(c, i) { bx(c, i, -310.5, xRight + GAP, c0, c1, 357.5, zBottom - 0.6); },
                    function(c, i) { bx(c, i, -316.4, -312.2, yf, 167.0, 359.5, zT); },
                    function(c, i) { bx(c, i, -316.4, -301.0, yf, 153.0 - SNUG_HALF, 359.5, zT); },
                    function(c, i) { bx(c, i, -312.2, xRight + GAP, 153.0 + SNUG_HALF, 155.0 + SNUG_HALF, 359.5, zT); },
                    function(c, i) { bx(c, i, -301.0, -295.8, 145.0, 161.0, 359.5, zT); },
                    // locating fork onto the Z rod's top screw head (slot open toward -x)
                    function(c, i) { bx(c, i, -328.0, -316.4, Z_HEAD_Y - Z_HEAD_R - 2.6, Z_HEAD_Y + Z_HEAD_R + 2.6, zShelf + GAP, zT); }],
                [function(c, i) { bx(c, i, -311.0, -306.6, 153.0 - SNUG_HALF, 153.0 + SNUG_HALF, 369.0, zT + 0.5); },
                    function(c, i) { cy(c, i, vec3(Z_HEAD_X, Z_HEAD_Y, zShelf), vec3(0, 0, 1), 0, 5.2, 2 * Z_HEAD_R); },
                    function(c, i) { bx(c, i, -329.0, Z_HEAD_X, Z_HEAD_Y - Z_HEAD_R, Z_HEAD_Y + Z_HEAD_R, zShelf, zShelf + 5.2); },
                    function(c, i) { cy(c, i, vec3(-310.8, 253.8, zShelf + GAP), vec3(0, 0, 1), 0, 11.0, M4_CLEAR); },
                    function(c, i) { nutTrap(c, i, vec3(-310.8, 253.8, 374.0), vec3(0, 0, 1), vec3(-1, 0, 0), M4_NUT_AF, M4_NUT_H, 7.0); },
                    function(c, i) { cy(c, i, vec3(xRight + GAP, 153.0, 362.0), vec3(1, 0, 0), 0, 10.0, M3_CLEAR); },
                    function(c, i) { nutTrap(c, i, vec3(-300.85, 153.0, 362.0), vec3(1, 0, 0), vec3(0, 0, -1), M3_NUT_AF, M3_NUT_H, 6.0); },
                    function(c, i) { cy(c, i, vec3(-305.6, f.holes[0][1], f.holes[0][2]), vec3(1, 0, 0), 0, 10.0, PIN_ACCESS); },
                    function(c, i) { cy(c, i, vec3(-305.6, f.holes[1][1], f.holes[1][2]), vec3(1, 0, 0), 0, 10.0, PIN_ACCESS); },
                    function(c, i) { cy(c, i, vec3(-312.2, f.holes[0][1], f.holes[0][2]), vec3(-1, 0, 0), 0, 2.2, PIN_HOLE); },
                    function(c, i) { cy(c, i, vec3(-312.2, f.holes[1][1], f.holes[1][2]), vec3(-1, 0, 0), 0, 2.2, PIN_HOLE); }], "Z");
        if (showSwitches)
            makeSwitch(context, id + "swZ", f, "Z");
}

// Bolt: base = underside of the head, axis = direction into the part
function makeBolt(context is Context, id is Id, base is Vector, axis is Vector, len, dia, headD, headH, name is string)
{
    cy(context, id + "shank", base, axis, 0, len, dia);
    cy(context, id + "head", base, -axis, 0, headH, headD);
    opBoolean(context, id + "u", { "tools" : qUnion([qCreatedBy(id + "shank", EntityType.BODY), qCreatedBy(id + "head", EntityType.BODY)]),
                "operationType" : BooleanOperationType.UNION });
    const q = qUnion([qCreatedBy(id + "shank", EntityType.BODY), qCreatedBy(id + "head", EntityType.BODY)]);
    setProperty(context, { "entities" : q, "propertyType" : PropertyType.NAME, "value" : name });
    setProperty(context, { "entities" : q, "propertyType" : PropertyType.APPEARANCE, "value" : color(0.55, 0.55, 0.6) });
}

function makeNut(context is Context, id is Id, c is Vector, axis is Vector, flatDir is Vector, af, h, holeD, name is string)
{
    hexPrism(context, id + "hex", c, axis, flatDir, af, h);
    cy(context, id + "hole", c - axis * h, axis, 0, 2 * h, holeD);
    opBoolean(context, id + "s", { "tools" : qCreatedBy(id + "hole", EntityType.BODY), "targets" : qCreatedBy(id + "hex", EntityType.BODY),
                "operationType" : BooleanOperationType.SUBTRACTION });
    setProperty(context, { "entities" : qCreatedBy(id + "hex", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : name });
    setProperty(context, { "entities" : qCreatedBy(id + "hex", EntityType.BODY), "propertyType" : PropertyType.APPEARANCE, "value" : color(0.7, 0.7, 0.2) });
}

// Hardware on hand: M4 socket-head screws, M3 hex-head bolts, nyloc nuts for both.
// Tips are placed touching the surface they clamp; each head still has 1.7-3.3 mm to go.
function makeHardware(context is Context, id is Id)
{
    makeBolt(context, id + "xl", vec3(35.29, 276.2, 337.5), vec3(-1, 0, 0), 12, 4.0, 7.0, 4.0, "bolt_M4x12_X_lock");
    makeNut(context, id + "xln", vec3(27.15, 276.2, 337.5), vec3(1, 0, 0), vec3(0, 0, -1), 7.0, 5.0, 4.0, "nut_M4_X_lock");
    makeBolt(context, id + "xc", vec3(13.0 + SWX, 276.2, 376.6), vec3(0, 0, -1), 10, 3.0, 6.0, 2.0, "bolt_M3x10_X_switch");
    makeNut(context, id + "xcn", vec3(13.0 + SWX, 276.2, 370.0), vec3(0, 0, 1), vec3(-1, 0, 0), 5.5, 4.0, 3.0, "nut_M3_X_switch");
    makeBolt(context, id + "yl", vec3(9.28, 340.0, 94.7), vec3(-1, 0, 0), 12, 4.0, 7.0, 4.0, "bolt_M4x12_Y_lock");
    makeNut(context, id + "yln", vec3(2.6, 340.0, 94.7), vec3(1, 0, 0), vec3(0, 1, 0), 7.0, 5.0, 4.0, "nut_M4_Y_lock");
    makeBolt(context, id + "yc", vec3(30.4, 320.3, 81.0), vec3(-1, 0, 0), 10, 3.0, 6.0, 2.0, "bolt_M3x10_Y_switch");
    makeNut(context, id + "ycn", vec3(23.9, 320.3, 81.0), vec3(1, 0, 0), vec3(0, -1, 0), 5.5, 4.0, 3.0, "nut_M3_Y_switch");
    makeBolt(context, id + "zl", vec3(-310.8, 253.8, 381.74), vec3(0, 0, -1), 12, 4.0, 7.0, 4.0, "bolt_M4x12_Z_lock");
    makeNut(context, id + "zln", vec3(-310.8, 253.8, 374.0), vec3(0, 0, 1), vec3(-1, 0, 0), 7.0, 5.0, 4.0, "nut_M4_Z_lock");
    makeBolt(context, id + "zc", vec3(-293.6, 153.0, 362.0), vec3(-1, 0, 0), 12, 3.0, 6.0, 2.0, "bolt_M3x12_Z_switch");
    makeNut(context, id + "zcn", vec3(-300.85, 153.0, 362.0), vec3(1, 0, 0), vec3(0, 0, -1), 5.5, 4.0, 3.0, "nut_M3_Z_switch");
    // printed pins through the switch holes (start on the face they are pushed in from)
    makePin(context, id + "px1", vec3(16.8 + SWX, 271.45, 374.8), vec3(0, 0, -1), "pin_X1");
    makePin(context, id + "px2", vec3(16.8 + SWX, 280.95, 374.8), vec3(0, 0, -1), "pin_X2");
    makePin(context, id + "py1", vec3(28.6, 324.3, 76.25), vec3(-1, 0, 0), "pin_Y1");
    makePin(context, id + "py2", vec3(28.6, 324.3, 85.75), vec3(-1, 0, 0), "pin_Y2");
    makePin(context, id + "pz1", vec3(-295.8, 148.25, 366.8), vec3(-1, 0, 0), "pin_Z1");
    makePin(context, id + "pz2", vec3(-295.8, 157.75, 366.8), vec3(-1, 0, 0), "pin_Z2");
}

function makePin(context is Context, id is Id, start is Vector, axis is Vector, name is string)
{
    cy(context, id, start, axis, 0, PIN_LEN, PIN_D);
    setProperty(context, { "entities" : qCreatedBy(id, EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : name });
    setProperty(context, { "entities" : qCreatedBy(id, EntityType.BODY), "propertyType" : PropertyType.APPEARANCE, "value" : color(0.95, 0.95, 0.95) });
}

export function buildLimitMounts(context is Context, id is Id, showSwitches is boolean, showHardware is boolean)
{
    mountX(context, id, showSwitches);
    mountY(context, id, showSwitches);
    mountZ(context, id, showSwitches);
    if (showHardware)
        makeHardware(context, id + "hw");
    mirrorXToLeft(context, id);
}

// The X bracket is drawn in the right-side frame; move it (with its switch, screws, nuts and
// pins) onto the left gantry side plate.
function mirrorXToLeft(context is Context, id is Id)
{
    // parts picked by the ids that made them, with their names and colours (a body's name can't be
    // read back inside the feature that set it)
    const bolt = color(0.55, 0.55, 0.6);
    const nut = color(0.7, 0.7, 0.2);
    const pin = color(0.95, 0.95, 0.95);
    const parts = [[id + "X", "mount_X", color(1.0, 0.45, 0.0)], [id + "swX" + "body", "switch_X", color(0.12, 0.12, 0.12)],
                   [id + "swX" + "lever", "lever_X", color(0.75, 0.75, 0.78)], [id + "hw" + "xl", "bolt_M4x12_X_lock", bolt],
                   [id + "hw" + "xln", "nut_M4_X_lock", nut], [id + "hw" + "xc", "bolt_M3x10_X_switch", bolt],
                   [id + "hw" + "xcn", "nut_M3_X_switch", nut], [id + "hw" + "px1", "pin_X1", pin], [id + "hw" + "px2", "pin_X2", pin]];
    const m = transform(vector(0, 0, X_LEFT_DZ) * millimeter) * mirrorAcross(plane(vector(X_MIRROR, 0, 0) * millimeter, vector(1, 0, 0)));
    var originals = [];
    for (var i = 0; i < size(parts); i += 1)
    {
        const q = qCreatedBy(parts[i][0], EntityType.BODY);
        if (size(evaluateQuery(context, q)) == 0)
            continue;
        // a mirror can't be applied with opTransform, so copy the body across and delete the original
        opPattern(context, id + ("mirX" ~ i), { "entities" : q, "transforms" : [m], "instanceNames" : ["L"] });
        setProperty(context, { "entities" : qCreatedBy(id + ("mirX" ~ i), EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : parts[i][1] });
        setProperty(context, { "entities" : qCreatedBy(id + ("mirX" ~ i), EntityType.BODY), "propertyType" : PropertyType.APPEARANCE, "value" : parts[i][2] });
        originals = append(originals, q);
    }
    if (size(originals) > 0)
        opDeleteBodies(context, id + "mirXdel", { "entities" : qUnion(originals) });
}

annotation { "Feature Type Name" : "Limit switch mounts (v3)" }
export const limitSwitchMounts = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Show switches" }
        definition.showSwitches is boolean;
        annotation { "Name" : "Show screws" }
        definition.showHardware is boolean;
    }
    {
        buildLimitMounts(context, id, definition.showSwitches, definition.showHardware);
    }, { "showSwitches" : true, "showHardware" : true });
