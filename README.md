# CIV-GOATS-Bridge-Sim
The best, kilo-newton winner, bridge simulator.

**Hi goats.**

## Necessary information for building the sim

### Bridge:
1. **Bridge length:** 1250mm - 1270mm
2. **Distance between supports:** 1200mm
3. **Height of deck above supports:** <200 mm
    - Height of deck above supports must be multiple of 20mm (e.g. 140mm, 160mm. CANNOT BE 150mm)
4. **Bridge width (at any point):** 100mm<
5. **Both ends:** Must have 60mm long flat portion under bottom of both ends

### Train:
- Train consists of one locomotive (head or end of train) and 2 bodies (freight cars). The train can reverse at any time, so the direction of travel does not matter.

**Dimensions**
1. Train height (from bottom of wheels to top): 85mm
2. Train width: 75mm
3. Wheel thickness: 10mm
4. Distance from center of wheel to front of train (front wheel): 52mm
5. Distance between wheels (centers) on one train: 176mm
6. Distance between two wheels (centers) on connected trains: 164mm

### Load Cases:
1. **Load Case 1**
    - Train is not loaded with additional weight. Total weight of train will be 400 N, and this weight will be EVENLY divided across 6 train axles
2. **Load Case 2**
    - **Base Case**: Locomotive weighs 182 N, two freight cars weigh 135 N each, for a total of 452 N. Locomotive will be at front or end of train, but NEVER Middle.
    - *For each subsequent pass*: We are not given numbers, but we do have ratios.
        - Freight car furthest from locomotive will have a HEAVIER weight than the other freight car
            - This heaviest freight car is ~1.1x weight of lighter freight car for any given pass
        - Locomotive is ~1.39x heavier than heaviest freight car for the pass.

### Material Information:
- **Matboard**
    1. Dimensions: 813mm x 1016mm x 1.27mm
    2. Tensile strength: 30 MPa
    3. Compressive strength: 6 MPa
    4. Shear strength: 4 MPa
    5. Young's modulus: 4000 MPa
    6. Poisson's ratio: 0.2
- **Contact Cement**
    1. Shear strength: Up to 2 MPa if properly cured (> 3days)


## Requirements For Bridge Simulator
TBD