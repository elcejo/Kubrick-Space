"""PDD training-grid jumps and delta-sigma weighted projection heads."""
import math
import torch


def prepare_eight_steps(config, heads):
    if (config.get("trajectory_steps"), config.get("L_min"), config.get("L_max")) != (128, 16, 32):
        raise ValueError("El Turbo PDD requiere la trayectoria 128/16/32 instalada.")
    values = config.get("sigmas", [])
    if (len(values) != 129 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in values)
            or values[0] != 1 or values[-1] != 0 or any(a <= b for a, b in zip(values, values[1:]))):
        raise ValueError("La trayectoria sigma de Turbo PDD es inválida.")
    if heads.ndim != 3 or heads.shape[0] != 128 or not bool(torch.isfinite(heads).all()):
        raise ValueError("Los cabezales Turbo PDD son inválidos.")
    grid = torch.tensor(values, dtype=torch.float64)
    deltas = grid[:-1] - grid[1:]
    projections = []
    for start in range(0, 128, 16):
        weights = deltas[start:start + 16]
        weights = (weights / weights.sum()).to(dtype=torch.float32)
        projections.append((heads[start:start + 16].float() * weights[:, None, None]).sum(dim=0))
    return torch.stack(projections), grid[::16].float()
