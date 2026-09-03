// Shared paycheck / tax estimator, used by schedule.html (and anywhere else
// that wants "roughly what will I actually take home" math).
//
// IMPORTANT: this is a planning ESTIMATE, not tax advice or real payroll
// withholding. It does not know about your W-4 elections, pre-tax
// deductions (401k, health insurance), dependents/credits, local or city
// income taxes, or multi-state work. Numbers are based on published 2026
// federal brackets/FICA figures and simplified state tables (flat rate, or
// a small set of approximate brackets) — always confirm against your
// state's current withholding tables or a real paycheck calculator before
// relying on this for anything important.

export const FEDERAL_STANDARD_DEDUCTION_2026 = {
  single: 16100,
  marriedJoint: 32200,
  headOfHousehold: 24150
};

// [bracketFloor, rate] pairs, ascending. Source: Tax Foundation / IRS Rev.
// Proc. 2025-32, 2026 tax year.
export const FEDERAL_BRACKETS_2026 = {
  single: [
    [0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24],
    [201775, 0.32], [256225, 0.35], [640600, 0.37]
  ],
  marriedJoint: [
    [0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24],
    [403550, 0.32], [512450, 0.35], [768700, 0.37]
  ],
  headOfHousehold: [
    [0, 0.10], [17700, 0.12], [67450, 0.22], [105700, 0.24],
    [201775, 0.32], [256200, 0.35], [640600, 0.37]
  ]
};

export const FICA_2026 = {
  socialSecurityRate: 0.062,
  socialSecurityWageBase: 184500,
  medicareRate: 0.0145,
  additionalMedicareRate: 0.009,
  // Additional 0.9% Medicare surtax kicks in above these (not inflation-adjusted).
  additionalMedicareThreshold: { single: 200000, marriedJoint: 250000, headOfHousehold: 200000 }
};

function taxFromBrackets(taxableIncome, brackets) {
  if (taxableIncome <= 0) return 0;

  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [floor, rate] = brackets[i];
    if (taxableIncome <= floor) break;

    const nextFloor = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    const upper = Math.min(taxableIncome, nextFloor);
    tax += (upper - floor) * rate;

    if (taxableIncome <= nextFloor) break;
  }
  return tax;
}

export function computeFederalTax(annualGross, filingStatus) {
  const deduction = FEDERAL_STANDARD_DEDUCTION_2026[filingStatus] ?? FEDERAL_STANDARD_DEDUCTION_2026.single;
  const taxable = Math.max(0, annualGross - deduction);
  const brackets = FEDERAL_BRACKETS_2026[filingStatus] ?? FEDERAL_BRACKETS_2026.single;
  return taxFromBrackets(taxable, brackets);
}

export function computeFICA(annualGross, filingStatus) {
  const socialSecurity = Math.min(annualGross, FICA_2026.socialSecurityWageBase) * FICA_2026.socialSecurityRate;
  const baseMedicare = annualGross * FICA_2026.medicareRate;

  const threshold = FICA_2026.additionalMedicareThreshold[filingStatus] ?? FICA_2026.additionalMedicareThreshold.single;
  const additionalMedicare = Math.max(0, annualGross - threshold) * FICA_2026.additionalMedicareRate;

  const medicare = baseMedicare + additionalMedicare;
  return { socialSecurity, medicare, total: socialSecurity + medicare };
}

// Simplified per-state table.
//   type: "none"     -> no state income tax on wages
//   type: "flat"     -> flat `rate` above a standard `deduction`
//   type: "brackets" -> small set of approximate marginal [floor, rate]
//                       pairs (single-filer thresholds)
// For married-filing-jointly, thresholds and the deduction are doubled as
// an approximation — most (not all) states roughly double single brackets
// for joint filers, so treat joint results as directionally correct rather
// than exact. Rates reflect published 2025/2026 figures at time of writing;
// state legislatures change these yearly, so treat as a planning estimate.
export const STATE_TAX = {
  AL: { type: "brackets", deduction: 2500, brackets: [[0, 0.02], [500, 0.04], [3000, 0.05]] },
  AK: { type: "none" },
  AZ: { type: "flat", rate: 0.025, deduction: 14600 },
  AR: { type: "brackets", deduction: 2200, brackets: [[0, 0.02], [4400, 0.039]] },
  CA: {
    type: "brackets", deduction: 5540,
    brackets: [[0, 0.01], [10756, 0.02], [25499, 0.04], [40245, 0.06], [55866, 0.08],
      [70606, 0.093], [360659, 0.103], [432787, 0.113], [721314, 0.123]]
  },
  CO: { type: "flat", rate: 0.044, deduction: 14600 },
  CT: {
    type: "brackets", deduction: 0,
    brackets: [[0, 0.02], [10000, 0.045], [50000, 0.055], [100000, 0.06], [200000, 0.065], [250000, 0.069], [500000, 0.0699]]
  },
  DE: {
    type: "brackets", deduction: 3250,
    brackets: [[0, 0], [2000, 0.022], [5000, 0.039], [10000, 0.048], [20000, 0.052], [25000, 0.0555], [60000, 0.066]]
  },
  DC: {
    type: "brackets", deduction: 15000,
    brackets: [[0, 0.04], [10000, 0.06], [40000, 0.065], [60000, 0.085], [250000, 0.0925], [500000, 0.0975], [1000000, 0.1075]]
  },
  FL: { type: "none" },
  GA: { type: "flat", rate: 0.0519, deduction: 12000 },
  HI: {
    type: "brackets", deduction: 2200,
    brackets: [[0, 0.014], [9600, 0.032], [19200, 0.055], [28800, 0.064], [38400, 0.068],
      [48000, 0.072], [72000, 0.076], [96000, 0.079], [120000, 0.0825]]
  },
  ID: { type: "flat", rate: 0.053, deduction: 14600 },
  IL: { type: "flat", rate: 0.0495, deduction: 2775 },
  IN: { type: "flat", rate: 0.0305, deduction: 1000 },
  IA: { type: "flat", rate: 0.038, deduction: 14600 },
  KS: { type: "brackets", deduction: 3500, brackets: [[0, 0.031], [23000, 0.0525], [46000, 0.057]] },
  KY: { type: "flat", rate: 0.04, deduction: 3160 },
  LA: { type: "flat", rate: 0.03, deduction: 12500 },
  ME: { type: "brackets", deduction: 14600, brackets: [[0, 0.058], [26050, 0.0675], [61600, 0.0715]] },
  MD: {
    type: "brackets", deduction: 2550,
    brackets: [[0, 0.02], [1000, 0.03], [2000, 0.04], [3000, 0.0475], [100000, 0.05], [125000, 0.0525], [150000, 0.055], [250000, 0.0575]]
  },
  MA: { type: "flat", rate: 0.05, deduction: 0, surtaxThreshold: 1000000, surtaxRate: 0.04 },
  MI: { type: "flat", rate: 0.0425, deduction: 5400 },
  MN: { type: "brackets", deduction: 14575, brackets: [[0, 0.0535], [31690, 0.068], [104090, 0.0785], [193240, 0.0985]] },
  MS: { type: "flat", rate: 0.044, deduction: 2300 },
  MO: {
    type: "brackets", deduction: 14600,
    brackets: [[0, 0], [1273, 0.02], [2546, 0.025], [3819, 0.03], [5092, 0.035], [6365, 0.04], [7638, 0.045], [8911, 0.0475]]
  },
  MT: { type: "brackets", deduction: 14600, brackets: [[0, 0.047], [20500, 0.059]] },
  NE: { type: "brackets", deduction: 7900, brackets: [[0, 0.0246], [3700, 0.0351], [22170, 0.0501], [35730, 0.0584]] },
  NV: { type: "none" },
  NH: { type: "none" },
  NJ: {
    type: "brackets", deduction: 1000,
    brackets: [[0, 0.014], [20000, 0.0175], [35000, 0.035], [40000, 0.05525], [75000, 0.0637], [500000, 0.0897], [1000000, 0.1075]]
  },
  NM: { type: "brackets", deduction: 14600, brackets: [[0, 0.017], [5500, 0.032], [11000, 0.047], [16000, 0.049], [210000, 0.059]] },
  NY: {
    type: "brackets", deduction: 8000,
    brackets: [[0, 0.04], [8500, 0.045], [11700, 0.0525], [13900, 0.055], [80650, 0.06], [215400, 0.0685], [1077550, 0.0965]]
  },
  NC: { type: "flat", rate: 0.0425, deduction: 12750 },
  ND: { type: "brackets", deduction: 14600, brackets: [[0, 0], [44725, 0.019], [101950, 0.0225]] },
  OH: { type: "brackets", deduction: 0, brackets: [[0, 0], [26050, 0.0275], [100000, 0.035]] },
  OK: { type: "brackets", deduction: 6350, brackets: [[0, 0.0025], [1000, 0.0075], [2500, 0.0175], [3750, 0.0275], [4900, 0.0375], [7200, 0.0475]] },
  OR: { type: "brackets", deduction: 14600, brackets: [[0, 0.0475], [4300, 0.0675], [10750, 0.0875], [125000, 0.099]] },
  PA: { type: "flat", rate: 0.0307, deduction: 0 },
  RI: { type: "brackets", deduction: 10550, brackets: [[0, 0.0375], [73450, 0.0475], [166950, 0.0599]] },
  SC: { type: "brackets", deduction: 14600, brackets: [[0, 0], [3460, 0.03], [17330, 0.062]] },
  SD: { type: "none" },
  TN: { type: "none" },
  TX: { type: "none" },
  UT: { type: "flat", rate: 0.0455, deduction: 0 },
  VT: { type: "brackets", deduction: 14600, brackets: [[0, 0.0335], [45400, 0.066], [110050, 0.076], [229550, 0.0875]] },
  VA: { type: "brackets", deduction: 8500, brackets: [[0, 0.02], [3000, 0.03], [5000, 0.05], [17000, 0.0575]] },
  WA: { type: "none" },
  WV: { type: "brackets", deduction: 0, brackets: [[0, 0.0222], [10000, 0.0296], [25000, 0.0333], [40000, 0.0478], [60000, 0.0512]] },
  WI: { type: "brackets", deduction: 13230, brackets: [[0, 0.035], [14320, 0.044], [28640, 0.053], [315310, 0.0765]] },
  WY: { type: "none" }
};

export function computeStateTax(annualGross, stateCode, filingStatus) {
  const info = STATE_TAX[stateCode];
  if (!info || info.type === "none") return 0;

  const jointMultiplier = filingStatus === "marriedJoint" ? 2 : 1;
  const deduction = (info.deduction || 0) * jointMultiplier;
  const taxable = Math.max(0, annualGross - deduction);

  if (info.type === "flat") {
    let tax = taxable * info.rate;
    if (info.surtaxThreshold && annualGross > info.surtaxThreshold * jointMultiplier) {
      tax += (annualGross - info.surtaxThreshold * jointMultiplier) * info.surtaxRate;
    }
    return tax;
  }

  const brackets = info.brackets.map(([floor, rate]) => [floor * jointMultiplier, rate]);
  return taxFromBrackets(taxable, brackets);
}

// Full estimate for one annual gross figure, broken down per pay period.
export function estimatePaycheck({ annualGross, filingStatus = "single", stateCode = "", periodsPerYear = 26 }) {
  const gross = Math.max(0, Number(annualGross) || 0);
  const periods = Math.max(1, Number(periodsPerYear) || 26);

  const federal = computeFederalTax(gross, filingStatus);
  const state = computeStateTax(gross, stateCode, filingStatus);
  const fica = computeFICA(gross, filingStatus);
  const totalTax = federal + state + fica.total;
  const netAnnual = gross - totalTax;

  return {
    annualGross: gross,
    federal,
    state,
    fica,
    totalTax,
    netAnnual,
    perPeriod: {
      periods,
      gross: gross / periods,
      federal: federal / periods,
      state: state / periods,
      fica: fica.total / periods,
      net: netAnnual / periods
    }
  };
}

export const US_STATES = [
  ["", "Select a state…"],
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "Washington DC"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"]
];
