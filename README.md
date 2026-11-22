# CIV-GOATS-Bridge-Sim
The best, kilo-newton winner, bridge simulator.

**Hi goats.**
hi!

## Necessary information for building the sim

### Bridge:
1. **Bridge length:** $`1250\text{--}1270\,\text{mm}`$
2. **Distance between supports:** $`1200\,\text{mm}`$
3. **Height of deck above supports:** $`<200\,\text{mm}`$
    - Height of deck above supports must be an integer multiple of $`20\,\text{mm}`$
4. **Bridge width (at any point):** $`>100\,\text{mm}`$
5. **Both ends:** Must have $`60\,\text{mm}`$ long flat portion under bottom of both ends

### Train:
- Train consists of 1 locomotive (head or end of train) and 2 bodies (freight cars). The train can reverse at any time, so the direction of travel does not matter.

**Dimensions**
1. Train height (from bottom of wheels to top): $`85\,\text{mm}`$
2. Train width: $`75\,\text{mm}`$
3. Wheel thickness: $`10\,\text{mm}`$
4. Distance from center of wheel to front of train (front wheel): $`52\,\text{mm}`$
5. Distance between wheels (centres) on one train: $`176\,\text{mm}`$
6. Distance between two wheels (centres) on connected trains: $`164\,\text{mm}`$

### Load Cases:
1. **Load Case 1**
    - Train is not loaded with additional weight. Total weight of train will be 400 N, and this weight will be EVENLY divided across 6 train axles
2. **Load Case 2**
    - **Base Case**: Locomotive weighs $`182\,\text{N}`$, two freight cars weigh $`135\,\text{N}`$ each, for a total of $`452\,\text{N}`$. Locomotive will be at front or end of train, but NEVER middle.
    - *For each subsequent pass*: We are not given numbers, but we do have ratios.
        - Freight car furthest from locomotive will have a HEAVIER weight than the other freight car
            - This heaviest freight car is $`\sim 1.1\times`$ weight of lighter freight car for any given pass
        - Locomotive is $`\sim 1.39\times`$ heavier than heaviest freight car for the pass.

### Material Information:
- **Matboard**
    1. Dimensions: $`813\,\text{mm}\times 1016\,\text{mm}\times 1.27\,\text{mm}`$
    2. Tensile strength: $`30\,\text{MPa}`$
    3. Compressive strength: $`6\,\text{MPa}`$
    4. Shear strength: $`4\,\text{MPa}`$
    5. Young's modulus: $`4000\,\text{MPa}`$
    6. Poisson's ratio: $`0.2`$
- **Contact Cement**
    1. Shear strength: Up to $`2\,\text{MPa}`$ if properly cured ($`>3`$ days)

## Requirements For Bridge Simulator
TBD
