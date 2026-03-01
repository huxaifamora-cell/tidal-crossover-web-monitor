//+------------------------------------------------------------------+
//|                              TidalCross_Ultimate_v3_LIVE.mq5     |
//|                               Copyright 2026, Uzumaki Trading    |
//|                                                                  |
//|  LIVE DASHBOARD EDITION — single file, runs alone on VPS.       |
//|  Pushes live data to your Render dashboard automatically.        |
//+------------------------------------------------------------------+
#property copyright "Uzumaki Trading"
#property version   "3.10"
#property strict

#include <Trade\Trade.mqh>

//─────────────────────────────────────────────────────────────────────
//  EA INPUT PARAMETERS
//─────────────────────────────────────────────────────────────────────
input int      InpEMAPeriod     = 5;
input int      InpBBPeriod      = 10;
input double   InpBBDev         = 2.0;
input double   InpLotSize       = 0.5;
input int      InpMagicNum      = 998877;
input double   InpFlatPoints    = 0.5;

//--- Dollar Management
input double   InpTargetProfit  = 10.0;
input double   InpStopLoss      = 5.0;
input double   InpTrailingAct   = 5.0;
input double   InpTrailingGap   = 2.0;

//─────────────────────────────────────────────────────────────────────
//  DASHBOARD SETTINGS
//─────────────────────────────────────────────────────────────────────
input string   InpDashURL       = "https://YOUR-APP.onrender.com/api/update"; // Dashboard URL
input int      InpPushEveryN    = 5;   // Push to dashboard every N ticks (reduce if slow VPS)

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

//─────────────────────────────────────────────────────────────────────
//  GLOBALS
//─────────────────────────────────────────────────────────────────────
int      hEMA[], hBB[];
bool     FirstCrossAchieved[];
CTrade   trade;
bool     IsTradingPaused = true;
string   buttonName      = "Tidal_Ultimate_Btn";
int      gTickCount      = 0;   // throttle dashboard pushes

//─────────────────────────────────────────────────────────────────────
//  SYMBOL → DASHBOARD ID MAP
//─────────────────────────────────────────────────────────────────────
string SymbolToId(const string sym)
{
   if(sym == "Volatility 5 Index")          return "v5";
   if(sym == "Volatility 10 Index")         return "v10";
   if(sym == "Volatility 15 Index")         return "v15";
   if(sym == "Volatility 25 Index")         return "v25";
   if(sym == "Volatility 30 Index")         return "v30";
   if(sym == "Volatility 50 Index")         return "v50";
   if(sym == "Volatility 75 Index")         return "v75";
   if(sym == "Volatility 90 Index")         return "v90";
   if(sym == "Volatility 100 Index")        return "v100";
   if(sym == "Volatility 5 (1s) Index")     return "v5s";
   if(sym == "Volatility 10 (1s) Index")    return "v10s";
   if(sym == "Volatility 15 (1s) Index")    return "v15s";
   if(sym == "Volatility 25 (1s) Index")    return "v25s";
   if(sym == "Volatility 30 (1s) Index")    return "v30s";
   if(sym == "Volatility 50 (1s) Index")    return "v50s";
   if(sym == "Volatility 75 (1s) Index")    return "v75s";
   if(sym == "Volatility 90 (1s) Index")    return "v90s";
   if(sym == "Volatility 100 (1s) Index")   return "v100s";
   if(sym == "Volatility 150 (1s) Index")   return "v150s";
   if(sym == "Volatility 250 (1s) Index")   return "v250s";
   return "";
}

//─────────────────────────────────────────────────────────────────────
//  GET CROSSOVER STATUS FOR ONE SYMBOL ON ONE TIMEFRAME
//─────────────────────────────────────────────────────────────────────
string GetTFCrossStatus(const string sym, ENUM_TIMEFRAMES tf,
                        string &outLabel, string &outSignal)
{
   int hE = iMA(sym, tf, InpEMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
   int hB = iBands(sym, tf, InpBBPeriod, 0, InpBBDev, PRICE_CLOSE);

   double ema[3], mbb[3];
   bool ok = (CopyBuffer(hE, 0, 0, 3, ema) == 3) &&
             (CopyBuffer(hB, 0, 0, 3, mbb) == 3);

   IndicatorRelease(hE);
   IndicatorRelease(hB);

   if(!ok) { outLabel = "No data"; outSignal = "neutral"; return "watch"; }

   double alpha    = 2.0 / (double)(InpEMAPeriod + 1);
   double goldLine = (mbb[0] - (1.0 - alpha) * ema[1]) / alpha;
   double bid      = SymbolInfoDouble(sym, SYMBOL_BID);
   double pt       = SymbolInfoDouble(sym, SYMBOL_POINT);

   bool nowAbove  = (bid >= goldLine);
   bool prevAbove = (ema[1] >= mbb[1]);
   double dist    = MathAbs(bid - goldLine) / pt;

   if(nowAbove != prevAbove)
   {
      outLabel  = "Crossed just now";
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
//  COUNT OPEN TRADES + TOTAL PROFIT FOR A SYMBOL
//─────────────────────────────────────────────────────────────────────
void GetSymbolTrades(const string sym, int &outCount, double &outProfit)
{
   outCount  = 0;
   outProfit = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket) &&
         PositionGetString(POSITION_SYMBOL) == sym &&
         PositionGetInteger(POSITION_MAGIC) == InpMagicNum)
      {
         outCount++;
         outProfit += PositionGetDouble(POSITION_PROFIT);
      }
   }
}

//─────────────────────────────────────────────────────────────────────
//  CALCULATE BULL BIAS (0–100) FROM BB POSITION + EMA SLOPE
//─────────────────────────────────────────────────────────────────────
double CalcBullBias(const string sym, int symIdx)
{
   double ema[3], mbb[3], upperBB[3], lowerBB[3];
   if(CopyBuffer(hEMA[symIdx], 0, 0, 3, ema)    < 3) return 50.0;
   if(CopyBuffer(hBB[symIdx],  0, 0, 3, mbb)    < 3) return 50.0;
   if(CopyBuffer(hBB[symIdx],  1, 0, 3, upperBB) < 3) return 50.0;
   if(CopyBuffer(hBB[symIdx],  2, 0, 3, lowerBB) < 3) return 50.0;

   double bid    = SymbolInfoDouble(sym, SYMBOL_BID);
   double range  = upperBB[0] - lowerBB[0];
   if(range <= 0) return 50.0;

   // Position within bands (0 = at lower, 100 = at upper)
   double pos    = ((bid - lowerBB[0]) / range) * 100.0;
   // EMA slope bonus: +5 if rising, -5 if falling
   double slope  = (ema[0] - ema[2]);
   double bonus  = (slope > 0) ? 5.0 : (slope < 0) ? -5.0 : 0.0;

   return MathMax(0.0, MathMin(100.0, pos + bonus));
}

//─────────────────────────────────────────────────────────────────────
//  PUSH ONE SYMBOL TO DASHBOARD
//─────────────────────────────────────────────────────────────────────
void PushSymbolToDashboard(const string sym, int symIdx,
                            bool eaActive, bool firstCross,
                            bool bbExpand, bool isFlat)
{
   string id = SymbolToId(sym);
   if(id == "") return;

   double bid    = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask    = SymbolInfoDouble(sym, SYMBOL_ASK);
   double pt     = SymbolInfoDouble(sym, SYMBOL_POINT);
   double spread = (pt > 0) ? ((ask - bid) / pt) : 0.0;

   // Open trade info
   int    openTrades;
   double openProfit;
   GetSymbolTrades(sym, openTrades, openProfit);

   // Bull/bear bias
   double bullBias = CalcBullBias(sym, symIdx);
   double bearBias = 100.0 - bullBias;

   // Overall signal from current timeframe
   string overallSignal = "neutral";
   {
      double ema2[1], mbb2[1];
      if(CopyBuffer(hEMA[symIdx], 0, 0, 1, ema2) == 1 &&
         CopyBuffer(hBB[symIdx],  0, 0, 1, mbb2) == 1)
         overallSignal = (bid >= mbb2[0]) ? "long" : "short";
   }

   // Build timeframes JSON
   ENUM_TIMEFRAMES tfs[]   = { PERIOD_M1, PERIOD_M5, PERIOD_M15, PERIOD_H1, PERIOD_H4 };
   string          tfNames[] = { "M1",     "M5",      "M15",      "H1",      "H4"  };
   string tfsJSON = "[";
   for(int i = 0; i < ArraySize(tfs); i++)
   {
      string lbl, sig;
      string status = GetTFCrossStatus(sym, tfs[i], lbl, sig);
      if(i > 0) tfsJSON += ",";
      tfsJSON += StringFormat("{\"tf\":\"%s\",\"status\":\"%s\",\"label\":\"%s\",\"signal\":\"%s\"}",
                              tfNames[i], status, lbl, sig);
   }
   tfsJSON += "]";

   // Assemble JSON body
   string body = StringFormat(
      "{"
        "\"id\":\"%s\","
        "\"bid\":%.5f,"
        "\"ask\":%.5f,"
        "\"spread\":%.1f,"
        "\"signal\":\"%s\","
        "\"eaScannerActive\":%s,"
        "\"firstCrossAchieved\":%s,"
        "\"bbExpanding\":%s,"
        "\"isFlat\":%s,"
        "\"openTrades\":%d,"
        "\"openProfit\":%.2f,"
        "\"bias\":{\"bull\":%.0f,\"bear\":%.0f},"
        "\"timeframes\":%s"
      "}",
      id, bid, ask, spread, overallSignal,
      eaActive   ? "true" : "false",
      firstCross ? "true" : "false",
      bbExpand   ? "true" : "false",
      isFlat     ? "true" : "false",
      openTrades, openProfit,
      bullBias, bearBias,
      tfsJSON
   );

   char   postData[];
   char   result[];
   string resHeaders;
   string reqHeaders = "Content-Type: application/json";

   StringToCharArray(body, postData, 0, StringLen(body));
   int code = WebRequest("POST", InpDashURL, reqHeaders, 5000, postData, result, resHeaders);

   if(code != 200 && code != -1)
      Print("⚠ Dashboard push failed [", sym, "] HTTP:", code);
}

//─────────────────────────────────────────────────────────────────────
//  PUSH ALL SYMBOLS AS ONE BATCH ARRAY
//  (Reduces HTTP round-trips from 20 → 1 per tick cycle)
//─────────────────────────────────────────────────────────────────────
void PushAllSymbolsBatch()
{
   string batchJSON = "[";
   int    total     = ArraySize(SymbolsList);

   for(int i = 0; i < total; i++)
   {
      string sym = SymbolsList[i];
      string id  = SymbolToId(sym);
      if(id == "") continue;

      double ema2[2], mbb2[2], upperBB[3], lowerBB[3];
      bool   ok = (CopyBuffer(hEMA[i], 0, 0, 2, ema2)    == 2) &&
                  (CopyBuffer(hBB[i],  0, 0, 2, mbb2)    == 2) &&
                  (CopyBuffer(hBB[i],  1, 0, 3, upperBB) == 3) &&
                  (CopyBuffer(hBB[i],  2, 0, 3, lowerBB) == 3);
      if(!ok) continue;

      double bid    = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask    = SymbolInfoDouble(sym, SYMBOL_ASK);
      double pt     = SymbolInfoDouble(sym, SYMBOL_POINT);
      double spread = (pt > 0) ? ((ask - bid) / pt) : 0.0;

      double alpha    = 2.0 / (double)(InpEMAPeriod + 1);
      double goldLine = (mbb2[0] - (1.0 - alpha) * ema2[1]) / alpha;

      bool upperExpanding = (upperBB[0] > upperBB[1]) && (upperBB[1] > upperBB[2]);
      bool lowerExpanding = (lowerBB[0] < lowerBB[1]) && (lowerBB[1] < lowerBB[2]);
      bool isBuySetup     = (bid >= goldLine);
      bool bbExpanding    = isBuySetup ? upperExpanding : lowerExpanding;
      bool isFlat         = (MathAbs(mbb2[0] - mbb2[1]) < InpFlatPoints * pt);
      bool eaActive       = !IsTradingPaused;
      bool firstCross     = FirstCrossAchieved[i];
      string overallSig   = (bid >= goldLine) ? "long" : "short";

      int    openTrades; double openProfit;
      GetSymbolTrades(sym, openTrades, openProfit);

      double bullBias = CalcBullBias(sym, i);
      double bearBias = 100.0 - bullBias;

      // Build timeframes sub-array
      ENUM_TIMEFRAMES tfs[]    = { PERIOD_M1, PERIOD_M5, PERIOD_M15, PERIOD_H1, PERIOD_H4 };
      string          tfNames[] = { "M1",      "M5",      "M15",      "H1",      "H4" };
      string tfsJSON = "[";
      for(int t = 0; t < ArraySize(tfs); t++)
      {
         string lbl, sig;
         string status = GetTFCrossStatus(sym, tfs[t], lbl, sig);
         if(t > 0) tfsJSON += ",";
         tfsJSON += StringFormat("{\"tf\":\"%s\",\"status\":\"%s\",\"label\":\"%s\",\"signal\":\"%s\"}",
                                 tfNames[t], status, lbl, sig);
      }
      tfsJSON += "]";

      if(i > 0) batchJSON += ",";
      batchJSON += StringFormat(
         "{"
           "\"id\":\"%s\","
           "\"bid\":%.5f,"
           "\"ask\":%.5f,"
           "\"spread\":%.1f,"
           "\"signal\":\"%s\","
           "\"eaScannerActive\":%s,"
           "\"firstCrossAchieved\":%s,"
           "\"bbExpanding\":%s,"
           "\"isFlat\":%s,"
           "\"openTrades\":%d,"
           "\"openProfit\":%.2f,"
           "\"bias\":{\"bull\":%.0f,\"bear\":%.0f},"
           "\"timeframes\":%s"
         "}",
         id, bid, ask, spread, overallSig,
         eaActive   ? "true" : "false",
         firstCross ? "true" : "false",
         bbExpanding ? "true" : "false",
         isFlat     ? "true" : "false",
         openTrades, openProfit,
         bullBias, bearBias,
         tfsJSON
      );
   }
   batchJSON += "]";

   char   postData[];
   char   result[];
   string resHeaders;
   string reqHeaders = "Content-Type: application/json";

   StringToCharArray(batchJSON, postData, 0, StringLen(batchJSON));
   int code = WebRequest("POST", InpDashURL, reqHeaders, 8000, postData, result, resHeaders);

   if(code != 200 && code != -1)
      Print("⚠ Batch dashboard push failed. HTTP:", code, " — check URL and API key");
}

//─────────────────────────────────────────────────────────────────────
//  ONINIT
//─────────────────────────────────────────────────────────────────────
int OnInit()
{
   int total = ArraySize(SymbolsList);
   ArrayResize(hEMA, total);
   ArrayResize(hBB,  total);
   ArrayResize(FirstCrossAchieved, total);

   for(int i = 0; i < total; i++)
   {
      hEMA[i] = iMA(SymbolsList[i],    _Period, InpEMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
      hBB[i]  = iBands(SymbolsList[i], _Period, InpBBPeriod,  0, InpBBDev, PRICE_CLOSE);
      FirstCrossAchieved[i] = false;

      if(hEMA[i] == INVALID_HANDLE || hBB[i] == INVALID_HANDLE)
         Print("❌ Handle Error: ", SymbolsList[i]);
   }

   trade.SetExpertMagicNumber(InpMagicNum);

   // UI Button
   ObjectCreate(0, buttonName, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, buttonName, OBJPROP_XDISTANCE, 20);
   ObjectSetInteger(0, buttonName, OBJPROP_YDISTANCE, 40);
   ObjectSetInteger(0, buttonName, OBJPROP_XSIZE,     180);
   ObjectSetInteger(0, buttonName, OBJPROP_YSIZE,     40);
   ObjectSetString (0, buttonName, OBJPROP_TEXT,      "SCANNER: PAUSED");
   ObjectSetInteger(0, buttonName, OBJPROP_BGCOLOR,   clrTomato);

   Print("✅ TidalCross Ultimate v3 LIVE loaded. Dashboard: ", InpDashURL);
   return(INIT_SUCCEEDED);
}

//─────────────────────────────────────────────────────────────────────
//  ONDEINIT
//─────────────────────────────────────────────────────────────────────
void OnDeinit(const int reason)
{
   ObjectDelete(0, buttonName);
   Comment("");
}

//─────────────────────────────────────────────────────────────────────
//  ONTICK  — unchanged trading logic + dashboard push added
//─────────────────────────────────────────────────────────────────────
void OnTick()
{
   ManageDollarStops();

   if(IsTradingPaused) {
      Comment("Tidal Ultimate: PAUSED\nMonitoring all indices...");
   }

   // ── Dashboard push (batched, every N ticks to avoid lagging the EA) ──
   gTickCount++;
   if(gTickCount >= InpPushEveryN)
   {
      gTickCount = 0;
      PushAllSymbolsBatch();
   }

   if(IsTradingPaused) return;

   string dashboard = "TIDAL ULTIMATE SCANNER\n------------------------\n";

   for(int i = 0; i < ArraySize(SymbolsList); i++)
   {
      string sym = SymbolsList[i];

      double ema[2], mbb[2], upperBB[3], lowerBB[3];
      if(CopyBuffer(hEMA[i], 0, 0, 2, ema)     < 2) continue;
      if(CopyBuffer(hBB[i],  0, 0, 2, mbb)     < 2) continue;
      if(CopyBuffer(hBB[i],  1, 0, 3, upperBB) < 3) continue;
      if(CopyBuffer(hBB[i],  2, 0, 3, lowerBB) < 3) continue;

      double alpha    = 2.0 / (double)(InpEMAPeriod + 1);
      double goldLine = (mbb[0] - (1.0 - alpha) * ema[1]) / alpha;
      double bid      = SymbolInfoDouble(sym, SYMBOL_BID);

      // 1. Cross Detection
      bool currentlyAbove = (bid >= goldLine);
      if(!FirstCrossAchieved[i])
         if(currentlyAbove != (ema[1] >= mbb[1])) FirstCrossAchieved[i] = true;

      // 2. Flatness Filter
      double mbbSlope = MathAbs(mbb[0] - mbb[1]);
      bool   isFlat   = (mbbSlope < InpFlatPoints * SymbolInfoDouble(sym, SYMBOL_POINT));

      // 3. BB Expansion Filter
      bool upperExpanding = (upperBB[0] > upperBB[1]) && (upperBB[1] > upperBB[2]);
      bool lowerExpanding = (lowerBB[0] < lowerBB[1]) && (lowerBB[1] < lowerBB[2]);
      bool isBuySetup     = (bid >= goldLine);
      bool bbExpanding    = isBuySetup ? upperExpanding : lowerExpanding;

      // Dashboard status string
      string expStatus = bbExpanding ? "[BB EXP ✔]" : "[BB FLAT ✘]";
      string status    = isFlat               ? "[FLAT]"       :
                         !FirstCrossAchieved[i]? "[WAIT CROSS]" :
                         !bbExpanding         ? "[NO EXPAND]"  : "[ACTIVE]";

      // 4. Trade Execution
      if(FirstCrossAchieved[i] && !isFlat && bbExpanding)
         ProcessSignal(sym, goldLine);

      dashboard += sym + ": " + status + " " + expStatus +
                   " P: " + DoubleToString(bid, 2) + "\n";
   }

   Comment(dashboard);
}

//─────────────────────────────────────────────────────────────────────
//  DOLLAR STOP MANAGEMENT  (unchanged)
//─────────────────────────────────────────────────────────────────────
void ManageDollarStops()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNum) continue;

      double profit = PositionGetDouble(POSITION_PROFIT);
      string sym    = PositionGetString(POSITION_SYMBOL);
      double bid    = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask    = SymbolInfoDouble(sym, SYMBOL_ASK);
      double lot    = PositionGetDouble(POSITION_VOLUME);

      if(profit >= InpTargetProfit || profit <= -InpStopLoss)
      {
         trade.PositionClose(ticket);
         continue;
      }

      if(profit >= InpTrailingAct)
      {
         double tickVal        = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
         double tickSize       = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
         double dollarPerPoint = (tickVal / tickSize) * lot;
         double currentSL      = PositionGetDouble(POSITION_SL);

         if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
         {
            double newSL = bid - (InpTrailingGap / dollarPerPoint);
            if(newSL > currentSL || currentSL == 0)
               trade.PositionModify(ticket, newSL, 0);
         }
         else
         {
            double newSL = ask + (InpTrailingGap / dollarPerPoint);
            if(newSL < currentSL || currentSL == 0)
               trade.PositionModify(ticket, newSL, 0);
         }
      }
   }
}

//─────────────────────────────────────────────────────────────────────
//  SIGNAL PROCESSING  (unchanged)
//─────────────────────────────────────────────────────────────────────
void ProcessSignal(const string sym, double target)
{
   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);

   bool isLong = false, isShort = false;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket) &&
         PositionGetString(POSITION_SYMBOL) == sym &&
         PositionGetInteger(POSITION_MAGIC) == InpMagicNum)
      {
         if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)  isLong  = true;
         if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL) isShort = true;
      }
   }

   double minL     = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double lStep    = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double finalLot = MathMax(minL, MathRound(InpLotSize / lStep) * lStep);

   if(bid >= target && !isLong)  { CloseSym(sym); trade.Buy (finalLot, sym, ask, 0, 0, "Tidal Multi"); }
   else
   if(bid <= target && !isShort) { CloseSym(sym); trade.Sell(finalLot, sym, bid, 0, 0, "Tidal Multi"); }
}

void CloseSym(const string sym)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket) &&
         PositionGetString(POSITION_SYMBOL) == sym &&
         PositionGetInteger(POSITION_MAGIC) == InpMagicNum)
         trade.PositionClose(ticket);
   }
}

//─────────────────────────────────────────────────────────────────────
//  BUTTON HANDLER  (unchanged)
//─────────────────────────────────────────────────────────────────────
void OnChartEvent(const int id, const long &lparam,
                  const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_OBJECT_CLICK && sparam == buttonName)
   {
      IsTradingPaused = !IsTradingPaused;
      ObjectSetString (0, buttonName, OBJPROP_TEXT,
                       IsTradingPaused ? "SCANNER: PAUSED" : "SCANNER: RUNNING");
      ObjectSetInteger(0, buttonName, OBJPROP_BGCOLOR,
                       IsTradingPaused ? clrTomato : clrSeaGreen);
      ObjectSetInteger(0, buttonName, OBJPROP_STATE, false);

      if(!IsTradingPaused)
         for(int i = 0; i < ArraySize(FirstCrossAchieved); i++)
            FirstCrossAchieved[i] = false;
   }
}
