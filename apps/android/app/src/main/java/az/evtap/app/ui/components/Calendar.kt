package az.evtap.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import az.evtap.app.R
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.booking.DayState
import az.evtap.core.booking.MonthGrid
import java.time.LocalDate
import java.time.YearMonth

/** Weekday initials from `calendar_weekdays` (Monday first). */
@Composable
fun WeekdayHeader(modifier: Modifier = Modifier) {
    val names = stringResource(R.string.calendar_weekdays).split(',')
    Row(modifier.fillMaxWidth()) {
        names.forEach { Text(it, style = EvTheme.type.micro, color = EvTheme.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f)) }
    }
}

/**
 * One month of day cells. States come from core (BookingCalendar): range start/end are black circles, the range is a
 * `pill` band, unavailable days are struck through (never colour alone), blocked/booked host days are labelled.
 */
@Composable
fun MonthView(
    month: YearMonth,
    stateOf: (LocalDate) -> DayState,
    onDayClick: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = EvTheme.colors
    val weeks = remember(month) { MonthGrid.weeks(month) }
    val blockedLabel = stringResource(R.string.calendar_blocked)
    val bookedLabel = stringResource(R.string.calendar_booked)
    val selectedLabel = stringResource(R.string.booking_legend_selected)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            Dates.monthTitle(month.year, month.monthValue),
            style = EvTheme.type.bodyStrong,
            modifier = Modifier.padding(start = 4.dp, top = 12.dp, bottom = 8.dp),
        )
        weeks.forEach { week ->
            Row(Modifier.fillMaxWidth()) {
                week.forEach { day ->
                    Box(Modifier.weight(1f).aspectRatio(1f), contentAlignment = Alignment.Center) {
                        if (day != null) {
                            val state = stateOf(day)
                            val inBand = state == DayState.IN_RANGE || state == DayState.START || state == DayState.END
                            if (inBand) {
                                // continuous band behind the range
                                Canvas(Modifier.fillMaxSize().padding(vertical = 4.dp)) {
                                    val l = if (state == DayState.START) size.width / 2 else 0f
                                    val r = if (state == DayState.END) size.width / 2 else size.width
                                    drawRect(c.pill, topLeft = Offset(l, 0f), size = androidx.compose.ui.geometry.Size(r - l, size.height))
                                }
                            }
                            val circle = state == DayState.START || state == DayState.END || state == DayState.SINGLE
                            val disabled = state == DayState.PAST || state == DayState.UNAVAILABLE
                            val bg = when {
                                circle -> c.ink
                                state == DayState.BLOCKED -> c.dangerBg
                                state == DayState.BOOKED -> c.infoBg
                                else -> Color.Transparent
                            }
                            val fg = when {
                                circle -> c.onInk
                                disabled -> c.subtle
                                state == DayState.BLOCKED -> c.danger
                                state == DayState.BOOKED -> c.info
                                else -> c.ink
                            }
                            val status = when (state) {
                                DayState.BLOCKED -> blockedLabel
                                DayState.BOOKED, DayState.UNAVAILABLE -> bookedLabel
                                DayState.START, DayState.END, DayState.SINGLE, DayState.IN_RANGE -> selectedLabel
                                else -> null
                            }
                            Box(
                                Modifier
                                    .padding(3.dp)
                                    .fillMaxSize()
                                    .clip(if (state == DayState.BLOCKED || state == DayState.BOOKED) RoundedCornerShape(12.dp) else CircleShape)
                                    .background(bg)
                                    .then(if (!disabled) Modifier.pressable({ onDayClick(day) }, role = Role.Button) else Modifier)
                                    .semantics {
                                        contentDescription = Dates.date(day)
                                        if (status != null) stateDescription = status
                                        if (circle || state == DayState.IN_RANGE) selected = true
                                        if (disabled) disabled()
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    day.dayOfMonth.toString(),
                                    style = EvTheme.type.label,
                                    color = fg,
                                    textDecoration = if (state == DayState.UNAVAILABLE) TextDecoration.LineThrough else null,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Legend chips under booking / host calendars. */
@Composable
fun CalendarLegend(items: List<Pair<Color, String>>, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        items.forEach { (color, label) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(12.dp).clip(CircleShape).background(color))
                Text(label, style = EvTheme.type.caption, color = EvTheme.colors.inkSecondary)
            }
        }
    }
}

/** First month shown (current) and the following [count] months. */
fun monthsFrom(start: LocalDate = LocalDate.now(), count: Int = 12): List<YearMonth> =
    (0 until count).map { YearMonth.from(start).plusMonths(it.toLong()) }
