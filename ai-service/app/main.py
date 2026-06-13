"""
OSS Pulse — AI Forecasting Service
==================================

Micro-service IA dédié à la fonctionnalité "Forecast" du frontend.

Modèle : lissage exponentiel double de Holt avec amortissement de tendance
(Holt's damped trend), implémenté en NumPy pur :

    level_t = α·y_t + (1-α)·(level_{t-1} + φ·trend_{t-1})
    trend_t = β·(level_t - level_{t-1}) + (1-β)·φ·trend_{t-1}
    ŷ_{t+h} = level_t + (φ + φ² + … + φ^h)·trend_t

Les hyper-paramètres (α, β, φ) sont sélectionnés par grid-search sur l'erreur
de prévision à 1 pas (SSE) — un vrai apprentissage sur la série reçue, sans
dépendance lourde. La bande d'incertitude est dérivée de l'écart-type des
résidus in-sample et s'élargit en √h (marche aléatoire des erreurs).

API :
    GET  /health            → liveness
    POST /forecast          → {series, horizon, clamp_min, clamp_max}
                              ⇒ {mid, lo, hi, model, params}
"""

from __future__ import annotations

import itertools
import math

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(
    title="OSS Pulse AI Service",
    version="1.0.0",
    description="Holt damped-trend forecaster for composite-score series",
)


class ForecastRequest(BaseModel):
    series: list[float] = Field(..., min_length=4, max_length=240,
                                description="Historique (ex. 12 scores mensuels)")
    horizon: int = Field(6, ge=1, le=24, description="Nombre de pas à projeter")
    clamp_min: float = Field(5.0, description="Borne basse du domaine (score)")
    clamp_max: float = Field(99.0, description="Borne haute du domaine (score)")


class ForecastResponse(BaseModel):
    mid: list[float]
    lo: list[float]
    hi: list[float]
    model: str
    params: dict[str, float]


def _holt_damped(y: np.ndarray, alpha: float, beta: float, phi: float):
    """Passe Holt amorti ; retourne (level, trend, résidus 1-pas)."""
    level, trend = y[0], y[1] - y[0]
    residuals = []
    for t in range(1, len(y)):
        forecast = level + phi * trend
        residuals.append(y[t] - forecast)
        new_level = alpha * y[t] + (1 - alpha) * forecast
        trend = beta * (new_level - level) + (1 - beta) * phi * trend
        level = new_level
    return level, trend, np.asarray(residuals)


def _fit(y: np.ndarray):
    """Grid-search (α, β, φ) minimisant la SSE des prévisions à 1 pas."""
    grid_a = np.linspace(0.2, 0.9, 8)
    grid_b = np.linspace(0.05, 0.6, 8)
    grid_p = np.linspace(0.80, 0.98, 7)
    best, best_sse = None, math.inf
    for a, b, p in itertools.product(grid_a, grid_b, grid_p):
        _, _, res = _holt_damped(y, a, b, p)
        sse = float(np.sum(res * res))
        if sse < best_sse:
            best_sse, best = sse, (a, b, p)
    return best, best_sse


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-forecast", "model": "holt-damped-trend"}


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    y = np.asarray(req.series, dtype=float)
    if np.any(~np.isfinite(y)):
        raise HTTPException(status_code=400, detail="series contains non-finite values")

    (alpha, beta, phi), _ = _fit(y)
    level, trend, residuals = _holt_damped(y, alpha, beta, phi)
    sigma = float(np.std(residuals, ddof=1)) if len(residuals) > 2 else 1.0
    sigma = max(sigma, 0.4)  # plancher : jamais de bande nulle

    clamp = lambda v: float(min(req.clamp_max, max(req.clamp_min, v)))
    mid, lo, hi = [], [], []
    damp_sum = 0.0
    for h in range(1, req.horizon + 1):
        damp_sum += phi ** h
        point = level + damp_sum * trend
        band = 1.2816 * sigma * math.sqrt(h)  # ~80% (z = 1.2816), élargissement √h
        mid.append(round(clamp(point), 1))
        lo.append(round(clamp(point - band), 1))
        hi.append(round(clamp(point + band), 1))

    return ForecastResponse(
        mid=mid, lo=lo, hi=hi,
        model="holt-damped-trend",
        params={"alpha": round(alpha, 3), "beta": round(beta, 3),
                "phi": round(phi, 3), "sigma": round(sigma, 3)},
    )
