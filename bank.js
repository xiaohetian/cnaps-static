// 从 cnaps-wails/db/query.go 移植；数据为 [id, cnap, bankname] 字符串数组。
(function (global) {
  "use strict";
  var rows = [], byCnap = Object.create(null), byName = Object.create(null);

  function init(data) {
    rows = data || [];
    byCnap = Object.create(null);
    byName = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (byCnap[r[1]] === undefined) byCnap[r[1]] = r;
      if (byName[r[2]] === undefined) byName[r[2]] = r;
    }
  }

  function smartSplit(name) {
    var remove = ["支行", "分行", "分理处", "储蓄所", "营业部"];
    var s = name;
    for (var i = 0; i < remove.length; i++) s = s.split(remove[i]).join("");
    var runes = Array.from(s), parts = [];
    for (var j = 0; j < runes.length; j += 2) parts.push(runes.slice(j, j + 2).join(""));
    var out = [];
    for (var k = 0; k < parts.length; k++) {
      if (parts[k] === "银行" && out.length > 0) out[out.length - 1] += "银行";
      else out.push(parts[k]);
    }
    var seen = Object.create(null), result = [];
    for (var m = 0; m < out.length; m++) {
      var t = out[m];
      if (!t || seen[t]) continue;
      seen[t] = true;
      result.push(t);
    }
    return result.join(" ");
  }

  function fuzzy(fields, limit) {
    var out = [];
    var lower = fields.map(function (f) { return f.toLowerCase(); });
    for (var i = 0; i < rows.length && out.length < limit; i++) {
      var name = rows[i][2].toLowerCase(), ok = true;
      for (var j = 0; j < lower.length; j++) {
        if (name.indexOf(lower[j]) < 0) { ok = false; break; }
      }
      if (ok) out.push({ cnap: rows[i][1], bankname: rows[i][2] });
    }
    return out;
  }

  function query(keyword, limit) {
    var kw = String(keyword == null ? "" : keyword).trim();
    if (!kw) return [];
    limit = limit > 0 ? limit : 500;
    if (/^\d{12}$/.test(kw)) {
      var hit = byCnap[kw];
      return hit ? [{ cnap: hit[1], bankname: hit[2] }] : [];
    }
    var fields = kw.split(/\s+/).filter(Boolean);
    var res = fuzzy(fields, limit);
    if (res.length > 0) return res;
    var split = smartSplit(kw);
    if (split !== kw) return fuzzy(split.split(/\s+/).filter(Boolean), limit);
    return [];
  }

  function batch(names) {
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var name = String(names[i] == null ? "" : names[i]).trim();
      if (!name) continue;
      var hit = byName[name], item = { input: name, found: false, cnap: "", bankname: "" };
      if (hit) {
        item.found = true; item.cnap = hit[1]; item.bankname = hit[2];
      } else {
        var res = query(name, 1);
        if (res.length) { item.found = true; item.cnap = res[0].cnap; item.bankname = res[0].bankname; }
      }
      out.push(item);
    }
    return out;
  }

  global.CnapsBank = { init: init, query: query, batch: batch };
})(typeof window !== "undefined" ? window : globalThis);
