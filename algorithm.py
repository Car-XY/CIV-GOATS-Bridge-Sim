TRAIN_LEN = 960 # in mm

bridge_len = 1250 # temporary value

# returns the left and right reaction forces (tuple) (Newtons) for the rightmost wheel of the train at a given position x (mm) from the left end of the bridge
# direction = 1 or -1, this is the direction in which the trains are moving. that is, where the locomotive is
def reactions(x, w, case, direction): 
    L = 1200 # distance between supports
    left, right = 0, 0

    wheel_x = [x, x - 176, x - 340, x - 516, x - 680, x - 856]

    if direction == -1:
        wheel_x.reverse()

    if case >= 2:
        weight = [1.39 * 1.1 * w / 2] * 2 + [w / 2] * 2 + [1.1 * w/ 2] * 2
    elif case == 1:
        weight = [182 / 2] * 2 + [135 / 2] * 4 
    else:
        weight = [200 / 3] * 6
    
    for i in range(6):
        if 0 < wheel_x[i] <= L:
            right += weight[i] * wheel_x[i]
    right /= L

    for i in range(6):
        if 0 <= wheel_x[i] <= L:
            left += weight[i]
    left -= right

    return left, right