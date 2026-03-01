//+------------------------------------------------------------------+
//|                        TidalCross_DataFeed_v1.mq5                |
//|                            Copyright 2026, Uzumaki Trading       |
//|                                                                  |
//|  DATA FEED ONLY — no trades, no orders.                          |
//|  Pushes live index data to your Render dashboard via WebRequest. |
//+------------------------------------------------------------------+
#property copyright "Uzumaki Trading"
#property version   "1.00"
#property strict

//─────────────────────────────────────────────────────────────────────
//  INPUTS
//─────────────────────────────────────────────────────────────────────
input int    InpEMAPeriod  = 5;
input int    InpBBPeriod   = 10;
input double InpBBDev      = 2.0;
input double InpFlatPoints = 0.5;
input string InpDashURL    = "https://YOUR-APP.onrender.com/api/update";
input int    InpPushEveryN = 3;   // push every N ticks per symbol

//─────────────────────────────────────────────────────────────────────
//  SYMBOLS
//─────────────────────────────────────────────────────────────────────
string SymbolsList[] = {
   "Volatility 5 Index",        "Volatility 10 Index",       "Volatility 15 Index",
   "Volatility 25 Index",       "Volatility 30 Index",       "Volatility 50 Index",
   "Volatility 75 Index",       "Volatility 90 Index",       "Volatility 100 Index",
   "Volatility 5 (1s) Index",   "Volatility 10 (1s) Index",  "Volatility 15 (1s) Index",
   "Volatility 25 (1s) Index",  "Volatility 30 (1s) Index",  "Volatility 50 (1s) Index",
   "Volatility 75 (1s) Index",  "Volatility 90 (1s) Index",  "Volatility 100 (1s) Index",
   "Volatility 150 (1s) Index", "Volatility 250 (1s) Index"
};

// Timeframes to report per symbol
ENUM_TIMEFRAMES ReportTFs[]    = { PERIOD_M1, PERIOD_M5, PERIOD_M15, PERIOD_M30, PERIOD_H1 };
string          ReportTFNames[] = { "M1",      "M5",      "M15",      "M30",      "H1" };

//─────────────────────────────────────────────────────────────────────
//  GLOBALS
//─────────────────────────────────────────────────────────────────────
// Per-symbol indicator handles for the CURRENT chart timeframe (used for bias)
int    hEMA[];
int    hBB[];
bool   handleOK[];   // false = symbol not available, skip it
int    tickCount[];  // per-symbol tick throttle counter
string buttonName = "TidalFeed_Btn";
bool   IsPaused   = false;

//─────────────────────────────────────────────────────────────────────
//  SYMBOL → API ID
//─────────────────────────────────────────────────────────────────────
string SymbolToId(const string sym)
{
   if(sym=="Volatility 5 Index")          return "v5";
   if(sym=="Volatility 10 Index")         return "v10";
   if(sym=="Volatility 15 Index")         return "v15";
   if(sym=="Volatility 25 Index")         return "v25";
   if(sym=="Volatility 30 Index")         return "v30";
   if(sym=="Volatility 50 Index")         return "v50";
   if(sym=="Volatility 75 Index")         return "v75";
   if(sym=="Volatility 90 Index")         return "v90";
   if(sym=="Volatility 100 Index")        return "v100";
   if(sym=="Volatility 5 (1s) Index")     return "v5s";
   if(sym=="Volatility 10 (1s) Index")    return "v10s";
   if(sym=="Volatility 15 (1s) Index")    return "v15s";
   if(sym=="Volatility 25 (1s) Index")    return "v25s";
   if(sym=="Volatility 30 (1s) Index")    return "v30s";
   if(sym=="Volatility 50 (1s) Index")    return "v50s";
   if(sym=="Volatility 75 (1s) Index")    return "v75s";
   if(sym=="Volatility 90 (1s) Index")    return "v90s";
   if(sym=="Volatility 100 (1s) Index")   return "v100s";
   if(sym=="Volatility 150 (1s) Index")   return "v150s";
   if(sym=="Volatility 250 (1s) Index")   return "v250s";
   return "";
}

//─────────────────────────────────────────────────────────────────────
//  ONINIT
//─────────────────────────────────────────────────────────────────────
int OnInit()
{
   int total = ArraySize(SymbolsList);
   ArrayResize(hEMA,     total);
   ArrayResize(hBB,      total);
   ArrayResize(handleOK, total);
   ArrayResize(tickCount,total);

   for(int i = 0; i < total; i++)
   {
      string sym = SymbolsList[i];
      tickCount[i] = 0;

      // Check the symbol actually exists in Market Watch
      if(!SymbolInfoInteger(sym, SYMBOL_SELECT))
      {
         // Try to add it
         SymbolSelect(sym, true);
         Sleep(200);
      }

      // Use M1 for all symbols — it's available on every Deriv index
      // regardless of which chart the EA is attached to
      hEMA[i] = iMA(sym, PERIOD_M1, InpEMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
      hBB[i]  = iBands(sym, PERIOD_M1, InpBBPeriod, 0, InpBBDev, PRICE_CLOSE);

      if(hEMA[i] == INVALID_HANDLE || hBB[i] == INVALID_HANDLE)
      {
         handleOK[i] = false;
         Print("⚠ Skipping ", sym, " — indicator handle failed. Is it in Market Watch?");
         if(hEMA[i] != INVALID_HANDLE) IndicatorRelease(hEMA[i]);
         if(hBB[i]  != INVALID_HANDLE) IndicatorRelease(hBB[i]);
      }
      else
      {
         handleOK[i] = true;
      }
   }

   // UI toggle button
   if(ObjectFind(0, buttonName) < 0)
   {
      ObjectCreate(0, buttonName, OBJ_BUTTON, 0, 0, 0);
      ObjectSetInteger(0, buttonName, OBJPROP_XDISTANCE, 20);
      ObjectSetInteger(0, buttonName, OBJPROP_YDISTANCE, 40);
      ObjectSetInteger(0, buttonName, OBJPROP_XSIZE,     200);
      ObjectSetInteger(0, buttonName, OBJPROP_YSIZE,     40);
      ObjectSetInteger(0, buttonName, OBJPROP_BGCOLOR,   clrSeaGreen);
      ObjectSetString (0, buttonName, OBJPROP_TEXT,      "DATA FEED: RUNNING");
   }

   Print("✅ TidalCross DataFeed loaded. Dashboard: ", InpDashURL);
   return INIT_SUCCEEDED;
}

//─────────────────────────────────────────────────────────────────────
//  ONDEINIT
//─────────────────────────────────────────────────────────────────────
void OnDeinit(const int reason)
{
   int total = ArraySize(SymbolsList);
   for(int i = 0; i < total; i++)
   {
      if(handleOK[i])
      {
         IndicatorRelease(hEMA[i]);
         IndicatorRelease(hBB[i]);
      }
   }
   ObjectDelete(0, buttonName);
   Comment("");
}

//─────────────────────────────────────────────────────────────────────
//  GET CROSSOVER STATUS FOR ONE SYMBOL ON ONE TIMEFRAME
//  Creates temporary handles — no stored handles needed per TF
//─────────────────────────────────────────────────────────────────────
string GetTFStatus(const string sym, ENUM_TIMEFRAMES tf,
                   string &outLabel, string &outSignal)
{
   int hE = iMA(sym, tf, InpEMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
   int hB = iBands(sym, tf, InpBBPeriod, 0, InpBBDev, PRICE_CLOSE);

   if(hE == INVALID_HANDLE || hB == INVALID_HANDLE)
   {
      if(hE != INVALID_HANDLE) IndicatorRelease(hE);
      if(hB != INVALID_HANDLE) IndicatorRelease(hB);
      outLabel = "No data"; outSignal = "neutral";
      return "watch";
   }

   double ema[3], mbb[3];
   bool ok = (CopyBuffer(hE, 0, 0, 3, ema) == 3) &&
             (CopyBuffer(hB, 0, 0, 3, mbb) == 3);

   IndicatorRelease(hE);
   IndicatorRelease(hB);

   if(!ok) { outLabel = "No data"; outSignal = "neutral"; return "watch"; }

   double alpha    = 2.0 / (InpEMAPeriod + 1.0);
   double goldLine = (mbb[0] - (1.0 - alpha) * ema[1]) / alpha;
   double bid      = SymbolInfoDouble(sym, SYMBOL_BID);
   double pt       = SymbolInfoDouble(sym, SYMBOL_POINT);
   bool   nowAbove = (bid >= goldLine);
   bool   wasAbove = (ema[1] >= mbb[1]);
   double dist     = MathAbs(bid - goldLine) / (pt > 0 ? pt : 1.0);

   if(nowAbove != wasAbove)
   {
      outLabel  = nowAbove ? "Bullish cross just now" : "Bearish cross just now";
      outSignal = nowAbove ? "long" : "short";
      return "recent";
   }
   if(dist < 8.0)
   {
      outLabel  = "Approaching crossover";
      outSignal = nowAbove ? "long" : "short";
      return "soon";
   }
   outLabel  = "Monitoring";
   outSignal = "neutral";
   return "watch";
}

//─────────────────────────────────────────────────────────────────────
//  CALCULATE BULL BIAS (0–100) FROM M1 BANDS + EMA SLOPE
//─────────────────────────────────────────────────────────────────────
double CalcBullBias(int symIdx, const string sym)
{
   double ema[3], upper[3], lower[3];
   if(CopyBuffer(hEMA[symIdx], 0, 0, 3, ema)   < 3) return 50.0;
   if(CopyBuffer(hBB[symIdx],  1, 0, 3, upper)  < 3) return 50.0;
   if(CopyBuffer(hBB[symIdx],  2, 0, 3, lower)  < 3) return 50.0;

   double bid   = SymbolInfoDouble(sym, SYMBOL_BID);
   double range = upper[0] - lower[0];
   if(range <= 0) return 50.0;

   double pos   = ((bid - lower[0]) / range) * 100.0;
   double slope = ema[0] - ema[2];
   double bonus = slope > 0 ? 5.0 : slope < 0 ? -5.0 : 0.0;
   return MathMax(0.0, MathMin(100.0, pos + bonus));
}

//─────────────────────────────────────────────────────────────────────
//  BUILD AND SEND BATCH JSON FOR ALL SYMBOLS
//─────────────────────────────────────────────────────────────────────
void PushAllToDashboard()
{
   int    total    = ArraySize(SymbolsList);
   string batchJSON = "[";
   bool   first    = true;

   for(int i = 0; i < total; i++)
   {
      string sym = SymbolsList[i];
      string id  = SymbolToId(sym);
      if(id == "" || !handleOK[i]) continue;

      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      double pt  = SymbolInfoDouble(sym, SYMBOL_POINT);
      if(bid <= 0) continue;  // symbol not yet streaming

      double spread = (pt > 0) ? (ask - bid) / pt : 0.0;

      // M1 EMA/BB for overall signal + bias
      double ema2[2], mbb2[2];
      bool   m1ok = (CopyBuffer(hEMA[i], 0, 0, 2, ema2) == 2) &&
                    (CopyBuffer(hBB[i],  0, 0, 2, mbb2) == 2);

      string overallSignal = "neutral";
      bool   firstCross    = false;
      bool   isFlat        = false;

      if(m1ok)
      {
         double alpha    = 2.0 / (InpEMAPeriod + 1.0);
         double goldLine = (mbb2[0] - (1.0 - alpha) * ema2[1]) / alpha;
         bool   nowAbove = (bid >= goldLine);
         bool   wasAbove = (ema2[1] >= mbb2[1]);
         firstCross    = (nowAbove != wasAbove);
         overallSignal = (bid >= goldLine) ? "long" : "short";
         isFlat        = MathAbs(mbb2[0] - mbb2[1]) < InpFlatPoints * pt;
      }

      // BB expanding check on M1
      double upperBB[3], lowerBB[3];
      bool   bbExpanding = false;
      if(CopyBuffer(hBB[i], 1, 0, 3, upperBB) == 3 &&
         CopyBuffer(hBB[i], 2, 0, 3, lowerBB) == 3)
      {
         bool upperExp = (upperBB[0] > upperBB[1]) && (upperBB[1] > upperBB[2]);
         bool lowerExp = (lowerBB[0] < lowerBB[1]) && (lowerBB[1] < lowerBB[2]);
         bbExpanding   = (overallSignal == "long") ? upperExp : lowerExp;
      }

      double bull = CalcBullBias(i, sym);
      double bear = 100.0 - bull;

      // Timeframes
      string tfsJSON = "[";
      for(int t = 0; t < ArraySize(ReportTFs); t++)
      {
         string lbl, sig;
         string status = GetTFStatus(sym, ReportTFs[t], lbl, sig);
         if(t > 0) tfsJSON += ",";
         tfsJSON += "{\"tf\":\"" + ReportTFNames[t] + "\","
                  + "\"status\":\"" + status + "\","
                  + "\"label\":\"" + lbl + "\","
                  + "\"signal\":\"" + sig + "\"}";
      }
      tfsJSON += "]";

      if(!first) batchJSON += ",";
      first = false;

      batchJSON += StringFormat(
         "{\"id\":\"%s\","
          "\"bid\":%.5f,"
          "\"ask\":%.5f,"
          "\"spread\":%.1f,"
          "\"signal\":\"%s\","
          "\"eaScannerActive\":true,"
          "\"firstCrossAchieved\":%s,"
          "\"bbExpanding\":%s,"
          "\"isFlat\":%s,"
          "\"openTrades\":0,"
          "\"openProfit\":0,"
          "\"bias\":{\"bull\":%.0f,\"bear\":%.0f},"
          "\"timeframes\":%s}",
         id, bid, ask, spread, overallSignal,
         firstCross  ? "true" : "false",
         bbExpanding ? "true" : "false",
         isFlat      ? "true" : "false",
         bull, bear,
         tfsJSON
      );
   }

   batchJSON += "]";

   if(first) return; // nothing valid to send

   char   postData[], result[];
   string resHeaders;
   string reqHeaders = "Content-Type: application/json";

   StringToCharArray(batchJSON, postData, 0, StringLen(batchJSON));
   int code = WebRequest("POST", InpDashURL, reqHeaders, 8000, postData, result, resHeaders);

   if(code != 200 && code != -1)
      Print("⚠ Dashboard push failed. HTTP:", code, " — check URL in inputs");
}

//─────────────────────────────────────────────────────────────────────
//  ONTICK
//─────────────────────────────────────────────────────────────────────
void OnTick()
{
   if(IsPaused) { Comment("TidalCross DataFeed: PAUSED"); return; }

   // Throttle: only push every InpPushEveryN ticks of the attached chart
   static int masterTick = 0;
   masterTick++;
   if(masterTick < InpPushEveryN) { UpdateDashboardComment(); return; }
   masterTick = 0;

   PushAllToDashboard();
   UpdateDashboardComment();
}

//─────────────────────────────────────────────────────────────────────
//  CHART COMMENT — shows live status on chart
//─────────────────────────────────────────────────────────────────────
void UpdateDashboardComment()
{
   int    total   = ArraySize(SymbolsList);
   int    ok      = 0;
   int    skipped = 0;

   for(int i = 0; i < total; i++)
      handleOK[i] ? ok++ : skipped++;

   Comment(
      "═══ TidalCross DataFeed ═══\n"
      "Dashboard : " + InpDashURL + "\n"
      "Symbols OK: " + IntegerToString(ok) + " / " + IntegerToString(total) + "\n"
      + (skipped > 0 ? "⚠ Skipped (not in Market Watch): " + IntegerToString(skipped) + "\n" : "")
      + "Push rate : every " + IntegerToString(InpPushEveryN) + " ticks\n"
      "NO TRADING — data feed only"
   );
}

//─────────────────────────────────────────────────────────────────────
//  BUTTON TOGGLE
//─────────────────────────────────────────────────────────────────────
void OnChartEvent(const int id, const long &lparam,
                  const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_OBJECT_CLICK && sparam == buttonName)
   {
      IsPaused = !IsPaused;
      ObjectSetString (0, buttonName, OBJPROP_TEXT,
                       IsPaused ? "DATA FEED: PAUSED" : "DATA FEED: RUNNING");
      ObjectSetInteger(0, buttonName, OBJPROP_BGCOLOR,
                       IsPaused ? clrTomato : clrSeaGreen);
      ObjectSetInteger(0, buttonName, OBJPROP_STATE, false);
   }
}
