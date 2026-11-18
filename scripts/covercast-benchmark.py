# Covercast against the standard forecasters a restaurant might use, on the
# same days and the same rule (each forecast sees only the days before it):
# same day last week, average of the last 4 / 8 same weekdays, Holt-Winters
# (ETS), seasonal ARIMA (the model family behind Google BigQuery's ARIMA_PLUS)
# and Prophet (with US holidays), refit at every origin.
# Run: node scripts/covercast-bench-export.mjs && python -I scripts/covercast-benchmark.py
# Needs: pip install statsmodels pandas prophet (not part of the app).
import json, sys, warnings, logging
import numpy as np, pandas as pd
warnings.filterwarnings('ignore')
logging.getLogger('cmdstanpy').setLevel(logging.ERROR)
logging.getLogger('prophet').setLevel(logging.ERROR)
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.statespace.sarimax import SARIMAX
from prophet import Prophet

data = json.load(open('scripts/.covercast-bench.json'))
which = sys.argv[1:] or list(data)
out = {}
for rid in which:
    d = data[rid]
    s = pd.Series([x['v'] for x in d['days']], index=pd.to_datetime([x['iso'] for x in d['days']]), dtype=float)
    s = s.interpolate(limit_direction='both')  # closed days filled for the models that need a regular series
    idx = list(s.index.strftime('%Y-%m-%d'))
    e0 = idx.index(d['evalFrom'])
    preds = {k: {1: {}, 7: {}} for k in ['last4', 'ets', 'sarima', 'prophet']}
    sar_params = None
    for o in range(e0 - 7, len(idx) - 1):
        hist = s.iloc[: o + 1]
        hz = [h for h in (1, 7) if o + h < len(idx) and o + h >= e0]
        if not hz:
            continue
        # Average of the last 4 same weekdays
        for h in hz:
            t = o + h
            same = [s.iloc[t - 7 * k] for k in range(1, 30) if t - 7 * k <= o][:4]
            preds['last4'][h][idx[t]] = float(np.mean(same))
        tr = hist.iloc[-728:]
        # Holt-Winters / ETS: damped trend, weekly multiplicative season
        f = ExponentialSmoothing(tr, trend='add', damped_trend=True, seasonal='mul', seasonal_periods=7).fit()
        fc = f.forecast(7)
        for h in hz: preds['ets'][h][idx[o + h]] = float(fc.iloc[h - 1])
        # Seasonal ARIMA (the model family behind Google BigQuery ARIMA_PLUS): params re-estimated weekly, state updated daily
        tr2 = hist.iloc[-364:]
        if sar_params is None or (o - e0) % 7 == 0:
            m = SARIMAX(tr2.values, order=(1, 0, 1), seasonal_order=(1, 1, 1, 7)).fit(disp=False)
            sar_params = m.params
        m = SARIMAX(tr2.values, order=(1, 0, 1), seasonal_order=(1, 1, 1, 7)).filter(sar_params)
        fc = m.forecast(7)
        for h in hz: preds['sarima'][h][idx[o + h]] = float(fc[h - 1])
        # Prophet with US holidays, refit every origin
        p = Prophet(weekly_seasonality=True, yearly_seasonality=True, daily_seasonality=False)
        p.add_country_holidays(country_name='US')
        p.fit(pd.DataFrame({'ds': tr.index, 'y': tr.values}))
        fut = p.make_future_dataframe(periods=7, include_history=False)
        fc = p.predict(fut)['yhat'].values
        for h in hz: preds['prophet'][h][idx[o + h]] = float(fc[h - 1])
    res = {}
    for h in ('1', '7'):
        rows = d['res'][h]
        dates = [k for k, r in rows.items() if r['a'] is not None]
        A = sum(rows[k]['a'] for k in dates)
        def wape(get):
            return round(100 * sum(abs(rows[k]['a'] - get(k)) for k in dates) / A, 2)
        res[h] = {
            'covercast': wape(lambda k: rows[k]['cc']),
            'usual8': wape(lambda k: rows[k]['cur']),
            'lastWeek': wape(lambda k: s.iloc[idx.index(k) - 7 * ((int(h) + 6) // 7)]),
            **{m: wape(lambda k, m=m: preds[m][int(h)][k]) for m in preds},
            'n': len(dates),
        }
    out[rid] = res
    print(rid, json.dumps(res), flush=True)
json.dump(out, open('scripts/.covercast-bench-out-%s.json' % '-'.join(which), 'w'))
