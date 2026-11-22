TRAIN_LEN = 960 # in mm

bridge_len = 1250 # temporary value

# wlog let the locomotive be on the right
# returns the left and right reaction forces (tuple) (Newtons) for the rightmost wheel of the train at a given position x (mm) from the left end of the bridge
def reactions(x, w, case): 
    left, right = 0, 0

    wheel_x = [x, x - 176, x - 340, x - 516, x - 680, x - 856]

    if case >= 2:
        weight = [1.39 * 1.1 * w / 2] * 2 + [w / 2] * 2 + [1.1 * w/ 2] * 2
    elif case == 1:
        weight = [182 / 2] * 2 + [135 / 2] * 4 
    else:
        weight = [200 / 3] * 6
    
    for i in range(6):
        if 0 < wheel_x[i] <= bridge_len:
            right += weight[i] * wheel_x[i]
    right /= bridge_len

    for i in range(6):
        if 0 <= wheel_x[i] <= bridge_len:
            left += weight[i]
    left -= right

    return left, right