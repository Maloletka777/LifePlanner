import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/src/ui/tab-bar';
import { useLifePlannerTheme, withAlpha } from '@/src/ui/theme';

import {
  GROWTH_CONTINUITY_LADDER,
  missesBeforeBreaking,
  routineGrowthTone,
  type RoutineGrowthStatus,
} from '../application/growth/routine-growth-model';
import { PLANNER_MAX_GROWING_ROUTINES } from '../domain/values/day-block';

import { CategoryChip } from './item-chip';
import {
  growthAwardLabel,
  growthStateCaption,
  growthStateLabel,
  selectGrowthCards,
  type GrowthCard,
} from './growth-model';
import { usePlannerGrowingRoutines, usePlannerHabitCatalogue } from './planner-provider';
import { habitDetailNavigation, plannerLocalDateFromDevice } from './ui-adapters';

/**
 * The second floor: one to three routines being grown, and nothing else.
 *
 * **This tab is not a smaller Overview.** Overview counts everything and answers «how am
 * I doing»; this accompanies the one to three things a person said matter now, and its
 * whole job is to be short. A dashboard that listed every habit would be Overview with
 * worse numbers.
 *
 * **The cap of three is what makes it work at all.** Taking on many things at once is a
 * known way to form none of them, and a screen that can show everything has not chosen —
 * choosing is the entire value of showing one thing at a time.
 *
 * **Nothing here counts down to the next award.** An expected, completion-contingent
 * reward is exactly the kind measured to undermine intrinsic motivation, so a medal is
 * shown once it is earned and never as «four more days». That is a deliberate cost: the
 * screen is less compelling than it could be, on purpose.
 */
export function GrowthScreen() {
  const theme = useLifePlannerTheme();
  const router = useRouter();
  const today = useMemo(() => plannerLocalDateFromDevice(), []);

  const growing = usePlannerGrowingRoutines();
  const catalogue = usePlannerHabitCatalogue('', 'active', today);

  const cards = useMemo(
    () => selectGrowthCards({
      attempts: growing.data ?? [],
      catalogue: catalogue.data ?? [],
    }),
    [catalogue.data, growing.data],
  );

  const ink = theme.today.primaryText;
  return <View style={[styles.root, { backgroundColor: theme.today.appSurface }]}>
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={[styles.pane, { paddingBottom: TAB_BAR_CLEARANCE + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: ink }]}>Growth</Text>
          <Text style={[styles.slots, { color: theme.today.secondaryText }]}>
            {`${cards.length} / ${PLANNER_MAX_GROWING_ROUTINES}`}
          </Text>
        </View>

        {/* An empty second floor is the ordinary state on day one, and it says what the
            floor is for rather than apologising for being empty. The way in is the
            create sheet's own switch, so there is no second place to learn. */}
        {cards.length > 0 ? null : <View style={styles.empty}>
          <Text style={[styles.emptyLine, { color: theme.today.secondaryText }]}>
            You are not growing anything yet
          </Text>
          <Text style={[styles.emptyCaption, { color: theme.today.tertiaryText }]}>
            Turn on «I am growing this» for a habit — up to three at once. The app will
            follow them and say when one starts to wobble.
          </Text>
        </View>}

        {cards.map((card) => <GrowthRoutineCard
          card={card}
          key={card.habitId}
          onOpen={() => router.push(habitDetailNavigation(card.habitId, today))}
        />)}

        {/* Said once, at the foot, because it is a property of the whole screen rather
            than of any card: a routine here is being accompanied, not scored. */}
        {cards.length === 0 ? null : <Text style={[styles.footnote, { color: theme.today.tertiaryText }]}>
          Medals appear once they are earned. How far the next one is is deliberately
          not written here.
        </Text>}
      </ScrollView>
    </SafeAreaView>
  </View>;
}

/**
 * One routine, and **two numbers**.
 *
 * The stretch it is on, and how many times it has come back. The second is the one that
 * makes this not a streak: a routine that broke four times and returned four times has
 * a story a streak counter cannot tell, and it is the story that predicts whether the
 * thing survives.
 */
function GrowthRoutineCard({ card, onOpen }: {
  readonly card: GrowthCard;
  readonly onOpen: () => void;
}) {
  const theme = useLifePlannerTheme();
  const ink = theme.today.primaryText;
  const tone = routineGrowthTone(card.status.state);
  // **Grey rather than red for a broken routine.** Red already means «overdue» in this
  // application, and a routine that stopped is dormant rather than alarming — a product
  // that looks reproachful gets deleted, and that is not reversible.
  const stateColor = tone === 'dormant'
    ? theme.today.tertiaryText
    : tone === 'attention' ? theme.today.attention : theme.today.completion;

  return <Pressable
    accessibilityHint="Opens the editor"
    accessibilityLabel={`${card.name}, ${growthStateLabel(card.status.state)}`}
    accessibilityRole="button"
    onPress={onOpen}
    style={[styles.card, {
      backgroundColor: theme.today.dashboardSurface,
      shadowColor: theme.dark ? '#000000' : ink,
    }]}
  >
    <View style={styles.cardTop}>
      <CategoryChip
        accentKey={card.accentKey}
        categoryKey={card.categoryKey}
        identity={card.identity}
        kind="habit"
        size={28}
      />
      <View style={styles.cardWords}>
        <Text numberOfLines={1} style={[styles.cardTitle, { color: ink }]}>{card.name}</Text>
        <Text numberOfLines={2} style={[styles.cardState, { color: stateColor }]}>
          {growthStateCaption(card.status)}
        </Text>
      </View>
    </View>

    {/* Two numbers, side by side, and the second is the point. */}
    <View style={styles.numbers}>
      <View style={styles.number}>
        <Text style={[styles.numberValue, { color: ink }]}>{card.status.displayedRun}</Text>
        <Text style={[styles.numberLabel, { color: theme.today.secondaryText }]}>in a row</Text>
      </View>
      <View style={[styles.numberDivider, { backgroundColor: withAlpha(ink, 0.09) }]} />
      <View style={styles.number}>
        <Text style={[styles.numberValue, { color: ink }]}>{card.status.returns}</Text>
        <Text style={[styles.numberLabel, { color: theme.today.secondaryText }]}>returns</Text>
      </View>
      <View style={[styles.numberDivider, { backgroundColor: withAlpha(ink, 0.09) }]} />
      <View style={styles.number}>
        <Text style={[styles.numberValue, { color: ink }]}>{card.status.totalClosed}</Text>
        <Text style={[styles.numberLabel, { color: theme.today.secondaryText }]}>in all</Text>
      </View>
    </View>

    {/* **Medals, earned and permanent.** A break costs the stretch and not one medal —
        that is the whole difference from a streak, expressed in what is drawn. The
        unearned rungs are shown as empty so the ladder is legible, and they carry no
        number and no distance: a ladder you can see is not a countdown. */}
    <View style={styles.medals}>
      {GROWTH_CONTINUITY_LADDER.map((rung) => {
        const earned = card.status.medals.includes(rung);
        return <View
          accessibilityLabel={earned ? growthAwardLabel(rung) : undefined}
          key={rung}
          style={[styles.medal, earned
            ? { backgroundColor: theme.today.completion, borderColor: theme.today.completion }
            : { borderColor: withAlpha(ink, 0.13) }]}
        >
          <Text style={[styles.medalText, { color: earned ? theme.today.onAccent : theme.today.tertiaryText }]}>{rung}</Text>
        </View>;
      })}
      {card.status.state === 'interrupted' || card.status.state === 'attention'
        ? <Text style={[styles.warning, { color: theme.today.secondaryText }]}>
          {card.status.state === 'interrupted'
            ? 'Interrupted'
            : `${missesBeforeBreaking(card.status)} more and it breaks`}
        </Text>
        : null}
    </View>

    {/* What the person said they do this after, when they said anything. It is drawn
        rather than only stored, because a cue nobody is reminded of is a cue nobody
        uses — and it is the strongest single thing a person can do for a routine. */}
    {card.cue === null ? null : <Text numberOfLines={1} style={[styles.cue, { color: theme.today.tertiaryText }]}>
      {`After: ${card.cue}`}
    </Text>}
  </Pressable>;
}

/** Unused for now; kept so the history query has one named consumer when the drill lands. */
export type { RoutineGrowthStatus };

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  pane: { gap: 10, paddingHorizontal: 22, paddingTop: 8 },
  header: { alignItems: 'baseline', flexDirection: 'row', gap: 10, minHeight: 40 },
  title: { flex: 1, fontSize: 28, fontWeight: '600', letterSpacing: -0.4, lineHeight: 32 },
  slots: { fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '600' },

  empty: { gap: 8, paddingTop: 40 },
  emptyLine: { fontSize: 17, fontWeight: '500', lineHeight: 22 },
  emptyCaption: { fontSize: 13, lineHeight: 18 },

  card: {
    borderRadius: 12,
    elevation: 2,
    gap: 12,
    padding: 14,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  cardTop: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  cardWords: { flex: 1, gap: 2, minWidth: 0 },
  cardTitle: { fontSize: 17, letterSpacing: -0.2, lineHeight: 22 },
  cardState: { fontSize: 13, lineHeight: 18 },

  numbers: { alignItems: 'stretch', flexDirection: 'row' },
  number: { alignItems: 'center', flex: 1, gap: 2 },
  numberValue: { fontSize: 22, fontVariant: ['tabular-nums'], fontWeight: '600', lineHeight: 26 },
  numberLabel: { fontSize: 11, lineHeight: 14 },
  numberDivider: { width: 1 },

  medals: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  medal: { alignItems: 'center', borderRadius: 11, borderWidth: 1.5, height: 22, justifyContent: 'center', minWidth: 30, paddingHorizontal: 6 },
  medalText: { fontSize: 11, fontVariant: ['tabular-nums'], fontWeight: '600' },
  warning: { flex: 1, fontSize: 11, textAlign: 'right' },

  cue: { fontSize: 12, lineHeight: 16 },

  footnote: { fontSize: 11, lineHeight: 15, paddingTop: 8 },
});
