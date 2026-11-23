import numpy as np
import matplotlib.pyplot as plt

############################## matlab sec. 0 ##############################
# 0. Initialize Parameters

L = 1200 
n = 1200 
P = 400
x = np.linspace(0, L, n + 1)

WHEEL_OFFSETS = np.array([0, 176, 340, 516, 680, 856])

E_MAT = 4000.0
NU_MAT = 0.2
SIGMA_T = 30.0
SIGMA_C = 6.0
TAU_M = 4.0
TAU_GLUE = 2.0

SHEET_AREA = 813 * 1016
SHEET_MASS_G = 750.0

############################## reactions ##############################
# we completed this before reading the matlab skeleton code oops

# TRAIN_LEN = 960 # in mm

# bridge_len = 1250 # temporary value

# # returns the left and right reaction forces (tuple) (Newtons) for the rightmost wheel of the train at a given position x (mm) from the left end of the bridge
# # direction = 1 or -1, this is the direction in which the trains are moving. that is, where the locomotive is
# def old_reactions(x, w, case, direction): 
#     left, right = 0, 0

#     wheel_x = [x, x - 176, x - 340, x - 516, x - 680, x - 856]

#     if direction == -1:
#         wheel_x.reverse()

#     if case >= 2:
#         weight = [1.39 * 1.1 * w / 2] * 2 + [w / 2] * 2 + [1.1 * w/ 2] * 2
#     elif case == 1:
#         weight = [182 / 2] * 2 + [135 / 2] * 4 
#     else:
#         weight = [200 / 3] * 6
    
#     for i in range(6):
#         if 0 < wheel_x[i] <= SPAN:
#             right += weight[i] * wheel_x[i]
#     right /= SPAN

#     for i in range(6):
#         if 0 <= wheel_x[i] <= SPAN:
#             left += weight[i]
#     left -= right

#     return left, right

############################## matlab sec. 1 ##############################
# 1. SFD, BMD under train loading

# returns (wheel_offsets, wheel_loads) for the given load case
# load_case: "LC1", "LC2_base", or "LC2_pass"
def train_loads(load_case, freight_weight=None, loco_leading=True):
    if load_case == "LC1":
        loads = np.full(6, 400 / 6)
    elif load_case == "LC2_base":
        loco, freight = 182.0, 135.0
        loads = np.array([loco, loco, freight, freight, freight, freight]) / 2
    else: # (load_case == "LC2_pass")
        light = freight_weight
        heavy = 1.10 * light
        loco = 1.39 * heavy
        loads = np.array([loco, loco, light, light, heavy, heavy]) / 2

    if not loco_leading:
        loads = loads[::-1]
    return WHEEL_OFFSETS.copy(), loads

# returns position of each wheel whne the leading wheel is at x_lead
def wheel_positions(x_lead, wheel_offsets):
    return x_lead - wheel_offsets

# returns the left and right reaction forces
def reactions(positions, loads, L):
    on = (positions >= 0) & (positions <= L)
    right_reaction = np.sum(loads[on] * positions[on]) / L # moments at A
    left_reaction = np.sum(loads[on]) - right_reaction # forces in y
    return left_reaction, right_reaction

# returns array of shear force V at each x
def sfd(x, positions, loads, L):
    left_reaction, right_reaction = reactions(positions, loads, L)

    V = np.full(len(x), left_reaction)
    for i in range(len(positions)):
        if 0 <= positions[i] <= L:
            V[x >= positions[i]] -= loads[i]
    return V

# returns array of bending moment M vs x
def bmd(x, positions, loads, L):
    left_reaction, right_reaction = reactions(positions, loads, L)

    M = left_reaction * x
    for i in range(len(positions)):
        if 0 <= positions[i] <= L:
            M = M - loads[i] * np.maximum(x - positions[i], 0)
    return M

# returns max V and M versus x
def envelopes(x, wheel_offsets, wheel_loads, L, step=1):
    SFD = np.zeros(len(x))
    BMD = np.zeros(len(x))
    SFDi = []
    BMDi = []

    # now we "walk through" the possible locations
    last = L + max(wheel_offsets)
    for x_lead in range(0, last + 1, step):
        # start location
        positions = wheel_positions(x_lead, wheel_offsets)

        V_right = sfd(x, positions, wheel_loads, L)
        V_left = sfd(x - 1e-9, positions, wheel_loads, L)
        M = bmd(x, positions, wheel_loads, L)

        SFD = np.maximum(SFD, np.abs(V_right))
        SFD = np.maximum(SFD, np.abs(V_left))
        BMD = np.maximum(BMD, M)

        SFDi.append(V_right)
        BMDi.append(M)

    return SFD, BMD, np.array(SFDi), np.array(BMDi)

############################## matlab sec. 2 ##############################
# 2. Define Bridge Parameters

def bridge_parameters(x):
    #                = xc,   bft, tft,  bfb,tfb,  hw,    tw,   bg,tg,   sw,    a
    param = np.array([[0,    100, 1.27, 80, 1.27, 78.73, 1.27, 5, 1.27, 77.46, 400],
                      [400,  100, 1.27, 80, 1.27, 78.73, 1.27, 5, 1.27, 77.46, 400],
                      [800,  100, 1.27, 80, 1.27, 78.73, 1.27, 5, 1.27, 77.46, 400],
                      [1200, 100, 1.27, 80, 1.27, 78.73, 1.27, 5, 1.27, 77.46, 400]])
    # x_c   Location, x, of cross-section change
    # bft   Top Flange Width
    # tft   Top Flange Thickness
    # bfb   Bottom Flange Width
    # tfb   Bottom Flange Thickness
    # hw    Web Height (between the bottom and top flanges)
    # tw    Web Thickness
    # bg    Glue Tab Width
    # tg    Glue Tab Thickness
    # sw    Spacing between Webs (centre to centre)
    # a     Diaphragm Spacing

    # Extracting user input assuming linear relationship
    bft = np.interp(x, param[:, 0], param[:, 1])
    tft = np.interp(x, param[:, 0], param[:, 2])
    bfb = np.interp(x, param[:, 0], param[:, 3])
    tfb = np.interp(x, param[:, 0], param[:, 4])
    hw = np.interp(x, param[:, 0], param[:, 5])
    tw = np.interp(x, param[:, 0], param[:, 6])
    bg = np.interp(x, param[:, 0], param[:, 7])
    tg = np.interp(x, param[:, 0], param[:, 8])
    sw = np.interp(x, param[:, 0], param[:, 9])
    a = np.interp(x, param[:, 0], param[:, 10])
    return bft, tft, bfb, tfb, hw, tw, bg, tg, sw, a

    # NOTE: Currently unfinished. Default values are from Design 0
    # right now this is simply initializing our parameters with defaults

############################## matlab sec. 3 ##############################
# 3. Calculate Sectional Properties

def sectional_properties(bft, tft, bfb, tfb, hw, tw, bg, tg):
    ybarbot = tfb / 2
    ybarmid = tfb + hw / 2 # remember there are TWO mid rectangles
    ybartop = tfb + hw + tft / 2
    ybartab = tfb + hw - tg / 2 # glue tab

    Abot = bfb * tfb
    Amid = tw * hw # again two mid rectangles
    Atop = bft * tft
    Atab = bg * tg # glue tab

    # ybar. location of centroidal axis from the bottom
    ybar = (Abot * ybarbot + 2 * Amid * ybarmid + Atop * ybartop + 2 * Atab * ybartab) / (Abot + 2 * Amid + Atop + 2 * Atab)

    ybot = ybar
    ytop = tfb + hw + tft - ybar

    Ibot = bfb * tfb ** 3 / 12
    Imid = tw * hw ** 3 / 12
    Itop = bft * tft ** 3 / 12
    Itab = bg * tg ** 3 / 12

    # I
    I = Ibot + Abot * (ybar - ybarbot) ** 2 + 2 * (Imid + Amid * (ybar - ybarmid) ** 2) + Itop + Atop * (ybar - ybartop) ** 2 + 2 * (Itab + Atab * (ybar - ybartab) ** 2)

    # Q at centroidal axes
    Qcent = Atop * (ybartop - ybar) + 2 * Atab * (ybartab - ybar) + tw * (tfb + hw - ybar) ** 2

    # Q at glue location
    Qglue = Atop * (ybartop - ybar)

    return ybar, ybot, ytop, I, Qcent, Qglue

############################## matlab sec. 4 ##############################
# 4. Calculate Applied Stress

def applied_stress(SFD, BMD, ybar, ybot, ytop, I, Qcent, Qglue, tw, bg):
    S_top = BMD * ytop / I
    S_bot = BMD * ybot / I
    T_cent = SFD * Qcent / (I * 2 * tw)
    T_glue = SFD * Qglue / (I * 2 * (bg + tw))
    return S_top, S_bot, T_cent, T_glue

############################## matlab sec. 5 ##############################
# 5. Material and Thin Plate Buckling Capacities

def capacities(bft, tft, ybar, ytop):
    E = E_MAT
    mu = NU_MAT
    S_tens = ...
    S_comp = ...
    T_max = ...
    T_gmax = ...
    S_buck1 = ...
    S_buck2 = ...
    S_buck3 = ...
    T_buck = ...
    return S_tens, S_comp, T_max, T_gmax, S_buck1, S_buck2, S_buck3, T_buck

############################## matlab sec. 6 ##############################
# 6. FOS

def factors_of_safety(S_top, S_bot, T_cent, T_glue,
                      S_tens, S_comp, T_max, T_gmax,
                      S_buck1, S_buck2, S_buck3, T_buck):
    FOS_tens = ...
    FOS_comp = ...
    FOS_shear = ...
    FOS_glue = ...
    FOS_buck1 = ...
    FOS_buck2 = ...
    FOS_buck3 = ...
    FOS_buckV = ...
    return (FOS_tens, FOS_comp, FOS_shear, FOS_glue,
            FOS_buck1, FOS_buck2, FOS_buck3, FOS_buckV)

############################## matlab sec. 7 ##############################
# 7. Min FOS and the failure load Pfail

def failure_load(FOS_tens, FOS_comp, FOS_shear, FOS_glue,
                 FOS_buck1, FOS_buck2, FOS_buck3, FOS_buckV):
    minFOS = ...
    Pf = ...
    return minFOS, Pf

############################## matlab sec. 8 ##############################
# 8. Vfail and Mfail

def failure_envelopes(SFD, BMD, FOS_tens, FOS_comp, FOS_shear, FOS_glue,
                      FOS_buck1, FOS_buck2, FOS_buck3, FOS_buckV):
    Mf_tens = ...
    Mf_comp = ...
    Vf_shear = ...
    Vf_glue = ...
    Mf_buck1 = ...
    Mf_buck2 = ...
    Mf_buck3 = ...
    Vf_buckV = ...
    return (Mf_tens, Mf_comp, Vf_shear, Vf_glue,
            Mf_buck1, Mf_buck2, Mf_buck3, Vf_buckV)

############################## matlab sec. 9 ##############################
# 9. Output plots of Vfail and Mfail

def output_plots(x, SFD, SFDi, Vf_shear):
    plt.subplot(2, 3, 1)
    plt.grid(True); plt.minorticks_on(); plt.grid(True, which="minor")
    plt.plot(x, Vf_shear, "r")
    plt.plot(x, -Vf_shear * SFD, "r")
    plt.plot(x, SFDi.T, "k")
    plt.plot([0, L], [0, 0], "k", linewidth=2)
    plt.legend(["Matboard Shear Failure"])
    plt.xlabel("Distance along bridge (mm)")
    plt.ylabel("Shear Force (N)")
    plt.show()

if __name__ == "__main__":
    wheel_offsets, wheel_loads = train_loads("LC1")
    SFD, BMD, SFDi, BMDi = envelopes(x, wheel_offsets, wheel_loads, L)
