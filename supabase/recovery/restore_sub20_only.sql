-- Restaurar funcionamento apenas com Campeonato Paranaense Sub-20 2026

-- 1. Desativar Sub-15
UPDATE public.competitions_registry
SET is_active = false
WHERE name = 'Paranaense Sub-15 2026';

-- 2. Garantir Sub-20 ativo
UPDATE public.competitions_registry
SET is_active = true
WHERE name = 'Paranaense Sub-20 2026 - 1ª Divisão';

-- 3. Corrigir matches contaminados para Sub-20 quando adversários forem os listados
-- (estes são times típicos do Sub-20, não Sub-15)
UPDATE public.matches
SET competition_name = 'Paranaense Sub-20 2026 - 1ª Divisão',
    season_year = 2026
WHERE competition_name = 'Paranaense Sub-15 2026'
  AND opponent IN ('CORITIBA', 'ATHLETICO', 'CIANORTE', 'OPERÁRIO', 'CASCAVEL', 'UNIÃO', 'ARAUCÁRIA', 'CITY LONDON', 'PATRIOTAS', 'HOPE', 'PARANÁ CLUBE');

-- Nota: match_player_stats permanece intacto, pois não alteramos ids dos matches.