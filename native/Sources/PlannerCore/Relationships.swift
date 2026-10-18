import Foundation

public struct RoutineConversionPreview: Equatable, Sendable {
    public var eligibleChildren: [UUID]
    public var conflicts: [String]
    public var earliestSafeDate: CalendarDay?
    public var allowed: Bool { conflicts.isEmpty }
}

extension PlannerSnapshot {
    public mutating func unlinkRelationship(_ id: UUID, from day: CalendarDay) throws {
        guard let i = relationships.firstIndex(where: { $0.id == id && $0.effective.contains(day) }) else { throw PlannerError.missing("Relationship is unavailable on this date") }
        var candidate = self
        let relationship = candidate.relationships[i]
        for index in candidate.observations.indices where candidate.observations[index].habitID == relationship.childID && relationship.effective.contains(candidate.observations[index].day) {
            if candidate.observations[index].contextRelationship == nil { candidate.observations[index].contextRelationship = relationship }
            if candidate.observations[index].contextConfiguration == nil {
                candidate.observations[index].contextConfiguration = candidate.habits.first(where: { $0.id == relationship.childID })?.configurations.first(where: { $0.id == candidate.observations[index].configurationID })
            }
        }
        if relationship.effective.start == day { candidate.relationships.remove(at: i) }
        else { candidate.relationships[i].effective.endExclusive = day }
        try candidate.validate(); self = candidate
    }
    public func routineConversionPreview(parentID: UUID, childIDs: Set<UUID>? = nil, from day: CalendarDay) -> RoutineConversionPreview {
        var result = RoutineConversionPreview(eligibleChildren: [], conflicts: [], earliestSafeDate: day)
        guard let parent = habits.first(where: { $0.id == parentID }), parent.configuration(on: day) != nil, !parent.isArchived(on: day) else {
            result.conflicts.append("Parent is inactive at this boundary"); return result
        }
        let organizational = relationships.filter { $0.parentID == parentID && $0.kind == .subhabit && $0.effective.contains(day) }
        let selected = organizational.filter { childIDs?.contains($0.childID) ?? true }
        if let childIDs, !childIDs.isSubset(of: Set(organizational.map(\.childID))) { result.conflicts.append("Select only direct organizational children") }
        for link in selected {
            guard let child = habits.first(where: { $0.id == link.childID }), child.configuration(on: day) != nil, !child.isArchived(on: day) else {
                result.conflicts.append("A selected child is inactive"); continue
            }
            result.eligibleChildren.append(link.childID)
        }
        if result.eligibleChildren.isEmpty { result.conflicts.append("No eligible organizational children") }
        if let latest = observations.filter({ $0.habitID == parentID && $0.day >= day }).map(\.day).max() {
            result.earliestSafeDate = try? latest.adding(days: 1)
            result.conflicts.append("Parent observations exist on or after the boundary")
        }
        return result
    }
    public mutating func convertToRoutine(parentID: UUID, childIDs: Set<UUID>? = nil, from day: CalendarDay) throws {
        let preview = routineConversionPreview(parentID: parentID, childIDs: childIDs, from: day)
        guard preview.allowed else { throw PlannerError.conflict(preview.conflicts.joined(separator: "; ")) }
        var candidate = self
        for child in preview.eligibleChildren {
            guard let i = candidate.relationships.firstIndex(where: { $0.parentID == parentID && $0.childID == child && $0.kind == .subhabit && $0.effective.contains(day) }) else { throw PlannerError.conflict("Relationship changed since preview") }
            var converted = candidate.relationships[i]
            if converted.effective.start == day { candidate.relationships.remove(at: i) }
            else { candidate.relationships[i].effective.endExclusive = day }
            converted.id = UUID(); converted.kind = .routineStep; converted.effective.start = day
            candidate.relationships.append(converted)
        }
        try candidate.validate(); self = candidate
    }
    public mutating func changeOrdinaryParent(childID: UUID, parentID: UUID?, role: RelationshipKind = .subhabit, from day: CalendarDay) throws {
        guard role == .subhabit || role == .routineStep else { throw PlannerError.invalid("Choose an organizational or routine-step relationship") }
        guard let child = habits.first(where: { $0.id == childID }), child.configuration(on: day) != nil, !child.isArchived(on: day) else { throw PlannerError.missing("Child is inactive") }
        if let parentID {
            guard let parent = habits.first(where: { $0.id == parentID }), parent.configuration(on: day) != nil, !parent.isArchived(on: day) else { throw PlannerError.missing("Parent is inactive") }
        }
        var candidate = self
        if let i = candidate.relationships.firstIndex(where: { $0.childID == childID && $0.effective.contains(day) }) {
            let old = candidate.relationships[i]
            guard old.kind == .subhabit || old.kind == .routineStep else { throw PlannerError.conflict("Unlink the conditional dependency before changing ordinary parent") }
            if old.effective.endExclusive != nil { throw PlannerError.conflict("A later relationship boundary already exists") }
            if old.effective.start == day { candidate.relationships.remove(at: i) }
            else { candidate.relationships[i].effective.endExclusive = day }
        }
        if let parentID { try candidate.addRelationship(Relationship(parentID: parentID, childID: childID, kind: role, from: day)) }
        try candidate.validate(); self = candidate
    }
}
