package az.evtap.core.booking

import az.evtap.core.model.Availability
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

/** Visual state of one calendar day. */
enum class DayState { PAST, UNAVAILABLE, NORMAL, START, END, SINGLE, IN_RANGE, BLOCKED, BOOKED }

/**
 * Night-based availability: a booking from checkIn to checkOut occupies the nights checkIn … checkOut-1, so the
 * check-out day itself can be the next guest's check-in. `blockedDates` are nights the host closed.
 */
class NightAvailability(availability: Availability?) {
    val blocked: Set<LocalDate> = availability?.blockedDates.orEmpty().mapNotNull { runCatching { LocalDate.parse(it) }.getOrNull() }.toSet()
    val booked: Set<LocalDate> = buildSet {
        availability?.bookedRanges.orEmpty().forEach { r ->
            val from = runCatching { LocalDate.parse(r.checkIn) }.getOrNull() ?: return@forEach
            val to = runCatching { LocalDate.parse(r.checkOut) }.getOrNull() ?: return@forEach
            var d = from
            while (d.isBefore(to)) {
                add(d)
                d = d.plusDays(1)
            }
        }
    }

    fun isNightFree(d: LocalDate): Boolean = d !in blocked && d !in booked

    /** All nights in [checkIn, checkOut) are free. */
    fun isRangeFree(checkIn: LocalDate, checkOut: LocalDate): Boolean {
        var d = checkIn
        while (d.isBefore(checkOut)) {
            if (!isNightFree(d)) return false
            d = d.plusDays(1)
        }
        return true
    }
}

/** Guest date-range selection (booking screen + daily-rent search filter). */
data class DateRange(val checkIn: LocalDate? = null, val checkOut: LocalDate? = null) {
    val complete: Boolean get() = checkIn != null && checkOut != null
    val nights: Int get() = if (checkIn != null && checkOut != null) java.time.temporal.ChronoUnit.DAYS.between(checkIn, checkOut).toInt() else 0

    /**
     * Tap handling: first tap = check-in; a later free day = check-out; anything else restarts the selection.
     * A check-out is rejected when the range would cross an unavailable night.
     */
    fun tap(day: LocalDate, today: LocalDate, nights: NightAvailability? = null): DateRange {
        if (day.isBefore(today)) return this
        val start = checkIn
        return when {
            start == null || checkOut != null || !day.isAfter(start) ->
                if (nights == null || nights.isNightFree(day)) DateRange(day, null) else this
            nights != null && !nights.isRangeFree(start, day) ->
                if (nights.isNightFree(day)) DateRange(day, null) else this
            else -> DateRange(start, day)
        }
    }

    fun stateOf(day: LocalDate, today: LocalDate, nights: NightAvailability? = null): DayState {
        if (day.isBefore(today)) return DayState.PAST
        val s = checkIn
        val e = checkOut
        return when {
            s != null && day == s -> if (e == null) DayState.SINGLE else DayState.START
            e != null && day == e -> DayState.END
            s != null && e != null && day.isAfter(s) && day.isBefore(e) -> DayState.IN_RANGE
            // a booked night can still be a check-out day when the previous night is free
            nights != null && !nights.isNightFree(day) ->
                if (s != null && e == null && day.isAfter(s) && nights.isRangeFree(s, day)) DayState.NORMAL else DayState.UNAVAILABLE
            else -> DayState.NORMAL
        }
    }
}

/** Host calendar: tap toggles a night between open and blocked; booked nights are read-only. */
object HostCalendar {
    fun toggle(blocked: Set<LocalDate>, day: LocalDate, today: LocalDate, booked: Set<LocalDate>): Set<LocalDate> = when {
        day.isBefore(today) || day in booked -> blocked
        day in blocked -> blocked - day
        else -> blocked + day
    }

    fun stateOf(day: LocalDate, today: LocalDate, blocked: Set<LocalDate>, booked: Set<LocalDate>): DayState = when {
        day.isBefore(today) -> DayState.PAST
        day in booked -> DayState.BOOKED
        day in blocked -> DayState.BLOCKED
        else -> DayState.NORMAL
    }
}

/** Month grid with Monday-first weeks; `null` cells pad the first/last week. */
object MonthGrid {
    fun weeks(month: YearMonth): List<List<LocalDate?>> {
        val first = month.atDay(1)
        val lead = (first.dayOfWeek.value - DayOfWeek.MONDAY.value + 7) % 7
        val cells = ArrayList<LocalDate?>()
        repeat(lead) { cells.add(null) }
        for (d in 1..month.lengthOfMonth()) cells.add(month.atDay(d))
        while (cells.size % 7 != 0) cells.add(null)
        return cells.chunked(7)
    }
}
