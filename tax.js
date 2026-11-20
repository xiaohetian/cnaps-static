// 从 cnaps-wails/tax/*.go 逐行移植；保留 Go math.Round 语义（half away from zero）。
(function (global) {
  "use strict";
  function goRound(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }
  function r2(v) { return goRound(v * 100) / 100; }

  var incomeMonthly = [
    { upTo: 3000, rate: 0.03, quick: 0 },
    { upTo: 12000, rate: 0.10, quick: 210 },
    { upTo: 25000, rate: 0.20, quick: 1410 },
    { upTo: 35000, rate: 0.25, quick: 2660 },
    { upTo: 55000, rate: 0.30, quick: 4410 },
    { upTo: 80000, rate: 0.35, quick: 7160 },
    { upTo: 0, rate: 0.45, quick: 15160 }
  ];
  var annual = [
    { upTo: 36000, rate: 0.03, quick: 0 },
    { upTo: 144000, rate: 0.10, quick: 2520 },
    { upTo: 300000, rate: 0.20, quick: 16920 },
    { upTo: 420000, rate: 0.25, quick: 31920 },
    { upTo: 660000, rate: 0.30, quick: 52920 },
    { upTo: 960000, rate: 0.35, quick: 85920 },
    { upTo: 0, rate: 0.45, quick: 181920 }
  ];
  var laborBrackets = [
    { upTo: 20000, rate: 0.20, quick: 0 },
    { upTo: 50000, rate: 0.30, quick: 2000 },
    { upTo: 0, rate: 0.40, quick: 7000 }
  ];
  function bracket(taxable, table) {
    for (var i = 0; i < table.length; i++) {
      var b = table[i];
      if (b.upTo === 0 || taxable <= b.upTo) return b;
    }
    return table[table.length - 1];
  }

  function invoiceTax(amount, rate, cityRatio, inclusive) {
    var txe = inclusive ? amount / (1 + rate) : amount;
    var vat = r2(txe * rate);
    var city = r2(vat * cityRatio);
    var edu = r2(vat * 0.03);
    var local = r2(vat * 0.02);
    var surch = r2(city + edu + local);
    var taxIncl = r2(txe + vat);
    var stamp = r2(taxIncl * 0.0003);
    return {
      taxExclusive: r2(txe), vat: vat, cityTax: city, eduSurcharge: edu,
      localEdu: local, surcharges: surch, stampDuty: stamp,
      taxInclusive: taxIncl, totalPayable: r2(vat + surch + stamp)
    };
  }

  function calcIncome(req) {
    var months = +req.months;
    if (months < 1) months = 1;
    var cumIncome = +req.cumIncome, cumSocial = +req.cumSocial,
        cumSpecial = +req.cumSpecial, paidBefore = +req.paidBefore;
    var taxable = cumIncome - cumSocial - cumSpecial - 5000 * months;
    if (taxable <= 0) return { cumTaxable: 0, rate: 0, quick: 0, cumTax: 0, thisTax: 0 };
    var b = bracket(taxable, annual);
    var cumTax = taxable * b.rate - b.quick;
    var thisTax = cumTax - paidBefore;
    if (thisTax < 0) thisTax = 0;
    return { cumTaxable: taxable, rate: b.rate, quick: b.quick, cumTax: cumTax, thisTax: thisTax };
  }

  function calcLaborRemuneration(req) {
    var income = +req.income;
    if (income <= 0) return { deduct: 0, taxable: 0, rate: 0, quick: 0, taxAmt: 0 };
    var deduct, taxable, b, table, taxAmt;
    if (req.resident) {
      deduct = income <= 4000 ? 800 : income * 0.20;
      taxable = income - deduct;
      b = bracket(taxable, laborBrackets);
      return { deduct: deduct, taxable: taxable, rate: b.rate, quick: b.quick, taxAmt: taxable * b.rate - b.quick };
    }
    deduct = income * 0.20;
    taxable = income - deduct;
    b = bracket(taxable, incomeMonthly);
    taxAmt = taxable * b.rate - b.quick;
    if (taxAmt < 0) taxAmt = 0;
    return { deduct: deduct, taxable: taxable, rate: b.rate, quick: b.quick, taxAmt: taxAmt };
  }

  function calcInvoice(req) {
    return invoiceTax(+req.amount, +req.rate, +req.cityRatio, !!req.inclusive);
  }

  function calcLabor(req) {
    var amount = +req.amount, feeRatio = +req.feeRatio, algA = !!req.algA;
    var r = invoiceTax(amount, +req.vatRate, +req.cityRatio, !!req.inclusive);
    var taxPayable = r.totalPayable, fee, total;
    if (algA) {
      total = goRound(amount * feeRatio);
      fee = total - r.totalPayable;
    } else {
      fee = goRound(amount * feeRatio);
      total = r2(r.totalPayable + fee);
    }
    return { taxPayable: taxPayable, fee: fee, total: total };
  }

  function laborDeductionCalc(invoice, taxRate, cityRatio, feeRatio, algA) {
    if (algA) return goRound(invoice * feeRatio);
    var vat = r2(invoice / (1 + taxRate) * taxRate);
    var city = r2(vat * cityRatio);
    var edu = r2(vat * 0.03);
    var local = r2(vat * 0.02);
    var stamp = r2(invoice * 0.0003);
    var fee = goRound(invoice * feeRatio);
    return vat + city + edu + local + stamp + fee;
  }

  function calcReverse(req) {
    var target = +req.target, feeRate = +req.feeRate,
        taxRate = +req.taxRate, cityRatio = +req.cityRatio, algA = !!req.algA;
    var invoice;
    if (algA) {
      invoice = target / (1 - feeRate);
    } else {
      var taxCoeff = taxRate / (1 + taxRate) * (1.05 + cityRatio);
      invoice = target / (1 - feeRate - taxCoeff - 0.0003);
      for (var i = 0; i < 20; i++) {
        var vat0 = invoice / (1 + taxRate) * taxRate;
        var deducts = vat0 + vat0 * cityRatio + vat0 * 0.03 + vat0 * 0.02 +
                      invoice * 0.0003 + goRound(invoice * feeRate);
        var newX = target + deducts;
        if (Math.abs(newX - invoice) < 0.01) { invoice = newX; break; }
        invoice = newX;
      }
    }
    var vat = invoice / (1 + taxRate) * taxRate;
    var city = vat * cityRatio;
    var edu = vat * 0.03;
    var local = vat * 0.02;
    var stamp = invoice * 0.0003;
    var fee = goRound(invoice * feeRate);
    var totalTax = vat + city + edu + local + stamp;
    var deduct = laborDeductionCalc(r2(invoice), taxRate, cityRatio, feeRate, algA);
    return {
      invoice: r2(invoice), vat: r2(vat), cityTax: r2(city),
      eduSurcharge: r2(edu), localEdu: r2(local), stampDuty: r2(stamp),
      mgmtFee: fee, totalTax: r2(totalTax), totalDeduct: r2(totalTax + fee),
      error: r2(invoice) - (deduct + target)
    };
  }

  global.CnapsTax = {
    calcIncome: calcIncome,
    calcLaborRemuneration: calcLaborRemuneration,
    calcInvoice: calcInvoice,
    calcLabor: calcLabor,
    calcReverse: calcReverse
  };
})(typeof window !== "undefined" ? window : globalThis);
