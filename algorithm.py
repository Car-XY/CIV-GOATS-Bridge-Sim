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
    leftr, rightr = reactions(positions, loads, L)

    V = np.full(len(x), leftr)
    for i in range(len(positions)):
        if 0 <= positions[i] <= L:
            V[x >= positions[i]] -= loads[i]
    return V

# returns array of bending moment M vs x
def bmd(x, positions, loads, L):
    leftr, rightr = reactions(positions, loads, L)

    M = leftr * x
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

if __name__ == "__main__":
    wheel_offsets, wheel_loads = train_loads("LC1")
    SFD, BMD, SFDi, BMDi = envelopes(x, wheel_offsets, wheel_loads, L)
