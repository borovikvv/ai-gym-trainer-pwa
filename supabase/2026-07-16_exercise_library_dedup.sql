-- Exercise Library Audit: remove near-literal duplicate exercises.
--
-- Found during a content audit: three exercises are functional duplicates
-- of other exercises already in the library (same equipment, same movement,
-- same target muscles — verified visually via guide images).
--
--   lateral-raises          duplicate of lateral-raise-dumbbell (identical DB lateral raise)
--   seated-cable-row        duplicate of cable-row (identical seated cable row)
--   triceps-rope-pushdown   duplicate of cable-triceps-pushdown (identical rope pushdown)
--
-- Live references in program_exercises / planned_workout_exercises were
-- remapped to the surviving canonical id in a separate transaction before
-- this migration ran (no schema change needed for that, so it isn't
-- repeated here — this file only removes the now-unreferenced rows and
-- fixes two dangling `alternatives` name references that pointed at the
-- exercises being removed).

update public.exercise_library set
  alternatives = (
    select jsonb_agg(
      case when elem->>'name' = 'Разведения гантелей в стороны'
        then jsonb_set(elem, '{name}', '"Махи гантелями в стороны"')
        else elem
      end
    )
    from jsonb_array_elements(alternatives) elem
  )
where id = 'cable-lateral-raise';

update public.exercise_library set
  alternatives = (
    select jsonb_agg(
      case when elem->>'name' = 'Разгибания на блоке с канатом'
        then jsonb_set(elem, '{name}', '"Разгибание рук на блоке"')
        else elem
      end
    )
    from jsonb_array_elements(alternatives) elem
  )
where id = 'bar-dips';

delete from public.exercise_library
where id in ('lateral-raises', 'seated-cable-row', 'triceps-rope-pushdown');
