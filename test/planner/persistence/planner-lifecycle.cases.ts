import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlannerLocalDate, parsePlannerLocalTime } from '../../../src/features/planner/domain';
import { ACTIVE_FROM, LONDON, baseCommand, createHarness, domainValue, tableCount } from './test-fixtures';

test('archive preserves a dependent, closes its relationship, and restore retains history', async (t) => {
  const h=await createHarness(20000); t.after(()=>h.database.close());
  const parent=await h.createHabit(baseCommand({name:'Parent',iconIdentity:{kind:'emoji',emoji:'🌅'},accentKey:'orange'})); assert.equal(parent.ok,true); if(!parent.ok)return;
  const identity = await h.database.getFirstAsync('SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: parent.value.id });
  const linked=await h.addHabitDependency({parentHabitId:parent.value.id,dependentSource:'new',dependent:{name:'Child',description:null,categoryId:null,tracking:baseCommand().tracking,importance:'normal',reminder:null},dependencyType:'follow_up',effectiveFrom:ACTIVE_FROM,effectiveTo:baseCommand().activeTo}); assert.equal(linked.ok,true, JSON.stringify(linked)); if(!linked.ok)return;
  const archived=await h.archiveHabit({habitId:parent.value.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON}); assert.equal(archived.ok,true, JSON.stringify(archived)); if(!archived.ok)return;
  assert.deepEqual(await h.database.getFirstAsync('SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: parent.value.id }), identity);
  assert.equal(archived.value.affectedDependentCount,1);
  assert.equal((await h.database.getFirstAsync<{count:number}>(`SELECT count(*) AS count FROM habit_schedule_versions WHERE habit_id=$id AND effective_from='2026-08-02';`,{$id:linked.value.dependent.id}))?.count,1);
  const closed = await h.database.getFirstAsync<{ effective_to: string; end_reason: string }>(`SELECT effective_to,end_reason FROM habit_dependency_versions WHERE id=$id;`,{$id:linked.value.relationship.id});
  assert.equal(closed?.effective_to, '2026-08-02'); assert.equal(closed?.end_reason, 'parent_archived');
  const duplicate=await h.archiveHabit({habitId:parent.value.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON}); assert.equal(duplicate.ok,true); if(duplicate.ok)assert.equal(duplicate.value.outcome,'already_archived');
  const restored=await h.restoreHabit({habitId:parent.value.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON}); assert.equal(restored.ok,true);
  assert.deepEqual(await h.database.getFirstAsync('SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: parent.value.id }), identity);
  const history = await h.database.getAllAsync<{ lifecycle: string; sequence_number: number }>('SELECT lifecycle,sequence_number FROM habit_lifecycle_transitions WHERE habit_id=$id ORDER BY sequence_number;',{$id:parent.value.id});
  assert.deepEqual(history.map(({ lifecycle, sequence_number }) => ({ lifecycle, sequence_number })),[{lifecycle:'active',sequence_number:1},{lifecycle:'archived',sequence_number:2},{lifecycle:'active',sequence_number:3}]);
});

test('archived habits reject observations and can be permanently deleted', async (t)=>{
  const h=await createHarness(30000); t.after(()=>h.database.close());
  const created=await h.createHabit(baseCommand()); assert.equal(created.ok,true); if(!created.ok)return;
  const identityBefore = await h.database.getFirstAsync('SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: created.value.id });
  assert.equal((await h.archiveHabit({habitId:created.value.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON})).ok,true);
  assert.deepEqual(await h.database.getFirstAsync('SELECT * FROM habit_visual_identities WHERE habit_id=$habitId;', { $habitId: created.value.id }), identityBefore);
  const record=await h.recordHabitObservation({habitId:created.value.id,occurrenceLocalDate:ACTIVE_FROM,occurrenceLocalTime:null,occurrenceTimezone:LONDON,value:{type:'checkbox',booleanValue:true},note:null});
  assert.equal(record.ok,false); if(!record.ok)assert.equal(record.error.code,'observation_habit_archived');
  assert.equal((await h.permanentlyDeleteHabit({habitId:created.value.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON,confirmed:true})).ok,true);
  assert.equal(await tableCount(h.database,'habits'),0); assert.equal(await tableCount(h.database,'habit_visual_identities'),0); assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'),[]);
});

test('parent deletion removes its conditional child rather than promoting it to a root', async (t)=>{
  const h=await createHarness(40000); t.after(()=>h.database.close());
  const parent=await h.createHabit(baseCommand({name:'Parent'})); assert.equal(parent.ok,true); if(!parent.ok)return;
  const linked=await h.addHabitDependency({parentHabitId:parent.value.id,dependentSource:'new',dependent:{name:'Child',description:null,categoryId:null,tracking:baseCommand().tracking,importance:'normal',reminder:null},dependencyType:'prerequisite',effectiveFrom:ACTIVE_FROM,effectiveTo:baseCommand().activeTo}); assert.equal(linked.ok,true, JSON.stringify(linked)); if(!linked.ok)return;
  const deleted=await h.permanentlyDeleteHabit({habitId:parent.value.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON,confirmed:true}); assert.equal(deleted.ok,true, JSON.stringify(deleted));
  assert.equal((await h.database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habits WHERE id=$id;',{$id:linked.value.dependent.id}))?.count,0);
  assert.equal((await h.database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habits WHERE id=$id;',{$id:parent.value.id}))?.count,0);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'),[]);
});

test('child deletion preserves its parent, sibling, and sibling relationship', async (t) => {
  const h=await createHarness(41000); t.after(()=>h.database.close());
  const parent=await h.createHabit(baseCommand({name:'Parent'})); assert.equal(parent.ok,true); if(!parent.ok)return;
  const first=await h.addHabitDependency({parentHabitId:parent.value.id,dependentSource:'new',dependent:{name:'First',description:null,categoryId:null,tracking:baseCommand().tracking,importance:'normal',reminder:null},dependencyType:'follow_up',effectiveFrom:ACTIVE_FROM,effectiveTo:baseCommand().activeTo});
  const sibling=await h.addHabitDependency({parentHabitId:parent.value.id,dependentSource:'new',dependent:{name:'Sibling',description:null,categoryId:null,tracking:baseCommand().tracking,importance:'normal',reminder:null},dependencyType:'follow_up',effectiveFrom:ACTIVE_FROM,effectiveTo:baseCommand().activeTo});
  assert.equal(first.ok && sibling.ok,true); if(!first.ok||!sibling.ok)return;
  assert.equal((await h.permanentlyDeleteHabit({habitId:first.value.dependent.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON,confirmed:true})).ok,true);
  const survivors=await h.database.getAllAsync<{name:string}>('SELECT name FROM habits ORDER BY name;'); assert.deepEqual(survivors.map(({name})=>name),['Parent','Sibling']);
  assert.equal((await h.database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habit_dependency_versions WHERE id=$id;',{$id:sibling.value.relationship.id}))?.count,1);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'),[]);
});

test('middle-node deletion removes its downstream leaf and preserves its ancestor', async (t) => {
  const h=await createHarness(42000); t.after(()=>h.database.close());
  const parent=await h.createHabit(baseCommand({name:'Parent'})); assert.equal(parent.ok,true); if(!parent.ok)return;
  const middle=await h.addHabitDependency({parentHabitId:parent.value.id,dependentSource:'new',dependent:{name:'Middle',description:null,categoryId:null,tracking:baseCommand().tracking,importance:'normal',reminder:null},dependencyType:'follow_up',effectiveFrom:ACTIVE_FROM,effectiveTo:baseCommand().activeTo}); assert.equal(middle.ok,true); if(!middle.ok)return;
  const leaf=await h.addHabitDependency({parentHabitId:middle.value.dependent.id,dependentSource:'new',dependent:{name:'Leaf',description:null,categoryId:null,tracking:baseCommand().tracking,importance:'normal',reminder:null},dependencyType:'follow_up',effectiveFrom:ACTIVE_FROM,effectiveTo:baseCommand().activeTo}); assert.equal(leaf.ok,true); if(!leaf.ok)return;
  for(const habitId of [parent.value.id,middle.value.dependent.id,leaf.value.dependent.id]) assert.equal((await h.recordHabitObservation({habitId,occurrenceLocalDate:ACTIVE_FROM,occurrenceLocalTime:null,occurrenceTimezone:LONDON,value:{type:'checkbox',booleanValue:true},note:null})).ok,true);
  const deleted=await h.permanentlyDeleteHabit({habitId:middle.value.dependent.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON,confirmed:true}); assert.equal(deleted.ok,true,JSON.stringify(deleted)); if(!deleted.ok)return;
  assert.equal((await h.database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habits WHERE id=$id;',{$id:leaf.value.dependent.id}))?.count,0);
  assert.equal((await h.database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habits WHERE id=$id;',{$id:middle.value.dependent.id}))?.count,0);
  assert.equal((await h.database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habits WHERE id=$id;',{$id:parent.value.id}))?.count,1);
  assert.equal((await h.database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habit_observations WHERE habit_id=$id;',{$id:leaf.value.dependent.id}))?.count,0);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'),[]);
});

test('forced permanent-delete failure rolls back configuration and ownership changes', async (t) => {
  const h=await createHarness(43000); t.after(()=>h.database.close());
  const created=await h.createHabit(baseCommand({name:'Keep me'})); assert.equal(created.ok,true); if(!created.ok)return;
  await h.database.execAsync(`CREATE TEMP TRIGGER fail_habit_delete BEFORE DELETE ON habits WHEN OLD.id='${created.value.id}' BEGIN SELECT RAISE(ABORT,'forced delete failure'); END;`);
  const before={habits:await tableCount(h.database,'habits'),schedules:await tableCount(h.database,'habit_schedule_versions'),times:await tableCount(h.database,'habit_planned_time_versions')};
  const result=await h.permanentlyDeleteHabit({habitId:created.value.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON,confirmed:true}); assert.equal(result.ok,false);
  assert.deepEqual({habits:await tableCount(h.database,'habits'),schedules:await tableCount(h.database,'habit_schedule_versions'),times:await tableCount(h.database,'habit_planned_time_versions')},before);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'),[]);
});

test('archive supports a habit with no current schedule and restore returns a typed schedule requirement', async (t) => {
  const h=await createHarness(44_000); t.after(()=>h.database.close());
  const created=await h.createHabit(baseCommand({name:'Legacy child'})); assert.equal(created.ok,true); if(!created.ok)return;
  await h.database.runAsync('UPDATE habit_schedule_versions SET effective_to=$date WHERE habit_id=$habitId;',{$date:'2026-08-02',$habitId:created.value.id});
  const archived=await h.archiveHabit({habitId:created.value.id,effectiveLocalDate:'2026-08-02',boundaryTimezone:LONDON});
  assert.equal(archived.ok,true,JSON.stringify(archived));
  const required=await h.restoreHabit({habitId:created.value.id,effectiveLocalDate:'2026-08-02',boundaryTimezone:LONDON});
  assert.equal(required.ok,true,JSON.stringify(required));
  if(!required.ok)return;
  assert.equal(required.value.outcome,'schedule_required');
  assert.equal(required.value.state,'archived');
  assert.equal(required.value.suggestedRestoreSchedule?.scheduleType,'daily');
  assert.equal(required.value.suggestedRestoreSchedule?.effectiveRange.effectiveFrom,'2026-08-02');
  assert.equal((await h.database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habit_lifecycle_transitions WHERE habit_id=$habitId;',{$habitId:created.value.id}))?.count,2);
  const restored=await h.restoreHabit({habitId:created.value.id,effectiveLocalDate:'2026-08-02',boundaryTimezone:LONDON,restoreSchedule:required.value.suggestedRestoreSchedule,restorePlannedLocalTime:'09:30'});
  assert.equal(restored.ok,true,JSON.stringify(restored));
  if(restored.ok) assert.equal(restored.value.outcome,'changed');
  assert.equal((await h.database.getFirstAsync<{planned_local_time:string|null}>('SELECT planned_local_time FROM habit_planned_time_versions WHERE habit_id=$habitId AND effective_from<=\'2026-08-02\' AND (effective_to IS NULL OR effective_to>\'2026-08-02\');',{$habitId:created.value.id}))?.planned_local_time,'09:30');
});

test('permanent delete does not require the selected legacy habit to have a current schedule', async (t) => {
  const h=await createHarness(45_000); t.after(()=>h.database.close());
  const created=await h.createHabit(baseCommand({name:'Old standalone'})); assert.equal(created.ok,true); if(!created.ok)return;
  await h.database.runAsync('DELETE FROM habit_schedule_versions WHERE habit_id=$habitId;',{$habitId:created.value.id});
  const deleted=await h.permanentlyDeleteHabit({habitId:created.value.id,effectiveLocalDate:ACTIVE_FROM,boundaryTimezone:LONDON,confirmed:true});
  assert.equal(deleted.ok,true,JSON.stringify(deleted));
  assert.equal(await tableCount(h.database,'habits'),0);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'),[]);
});

test('deleting a legacy parent repairs an expired surviving child from retained schedule context', async (t) => {
  const h=await createHarness(46_000); t.after(()=>h.database.close());
  const parent=await h.createHabit(baseCommand({name:'Legacy parent'})); assert.equal(parent.ok,true); if(!parent.ok)return;
  const child=await h.createHabit(baseCommand({name:'Legacy child'})); assert.equal(child.ok,true); if(!child.ok)return;
  const relationshipEnd=parsePlannerLocalDate('2026-08-02'); assert.equal(relationshipEnd.ok,true); if(!relationshipEnd.ok)return;
  const linked=await h.addHabitDependency({parentHabitId:parent.value.id,dependentSource:'existing',dependentHabitId:child.value.id,dependencyType:'follow_up',effectiveFrom:ACTIVE_FROM,effectiveTo:relationshipEnd.value}); assert.equal(linked.ok,true,JSON.stringify(linked)); if(!linked.ok)return;
  await h.database.runAsync('DELETE FROM habit_schedule_versions WHERE habit_id=$habitId;',{$habitId:child.value.id});
  const actionDate=parsePlannerLocalDate('2026-08-03'); assert.equal(actionDate.ok,true); if(!actionDate.ok)return;
  const deleted=await h.permanentlyDeleteHabit({habitId:parent.value.id,effectiveLocalDate:actionDate.value,boundaryTimezone:LONDON,confirmed:true});
  assert.equal(deleted.ok,true,JSON.stringify(deleted));
  assert.equal((await h.database.getFirstAsync<{count:number}>('SELECT count(*) AS count FROM habits WHERE id=$habitId;',{$habitId:child.value.id}))?.count,1);
  assert.equal((await h.database.getFirstAsync<{count:number}>(`SELECT count(*) AS count FROM habit_schedule_versions WHERE habit_id=$habitId AND effective_from='2026-08-04';`,{$habitId:child.value.id}))?.count,1);
  assert.deepEqual(await h.database.getAllAsync('PRAGMA foreign_key_check;'),[]);
});

test('restore carries the stored length forward instead of dropping it', async (t) => {
  // **Found by an audit, and it was data loss.** Restore opens a *new* planned-time
  // version, and that insert named no duration — so an archived habit that took ninety
  // minutes came back with no length at all, silently, on every restore. Restoring says
  // when a habit runs again; it says nothing about how long it takes.
  const h=await createHarness(80_000); t.after(()=>h.database.close());
  const created=await h.createHabit(baseCommand({name:'Gym',plannedDurationMinutes:90,plannedTime:domainValue(parsePlannerLocalTime('07:00','plannedTime'))}));
  assert.equal(created.ok,true,JSON.stringify(created)); if(!created.ok)return;

  await h.database.runAsync('UPDATE habit_schedule_versions SET effective_to=$date WHERE habit_id=$habitId;',{$date:'2026-08-02',$habitId:created.value.id});
  assert.equal((await h.archiveHabit({habitId:created.value.id,effectiveLocalDate:'2026-08-02',boundaryTimezone:LONDON})).ok,true);
  const required=await h.restoreHabit({habitId:created.value.id,effectiveLocalDate:'2026-08-02',boundaryTimezone:LONDON});
  assert.equal(required.ok,true); if(!required.ok)return;
  const restored=await h.restoreHabit({habitId:created.value.id,effectiveLocalDate:'2026-08-02',boundaryTimezone:LONDON,restoreSchedule:required.value.suggestedRestoreSchedule,restorePlannedLocalTime:'09:30'});
  assert.equal(restored.ok,true,JSON.stringify(restored));

  const row=await h.database.getFirstAsync<{planned_local_time:string|null;planned_duration_minutes:number|null}>(
    `SELECT planned_local_time,planned_duration_minutes FROM habit_planned_time_versions
     WHERE habit_id=$habitId AND effective_from<='2026-08-02' AND (effective_to IS NULL OR effective_to>'2026-08-02');`,
    {$habitId:created.value.id},
  );
  // The minute is what restore was asked to set; the length is what it must not touch.
  assert.equal(row?.planned_local_time,'09:30');
  assert.equal(row?.planned_duration_minutes,90,'the length must survive a restore');
});
