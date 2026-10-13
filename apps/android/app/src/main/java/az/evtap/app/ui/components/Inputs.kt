package az.evtap.app.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.foundation.selection.toggleable
import az.evtap.app.R
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Phone

/**
 * Text input: visible label above (never placeholder-only), `surfaceRaised`, radius 16, 48 dp+, 1 dp hairline;
 * focus = ink border + 20 % ink ring; error text below the field and announced to accessibility services.
 */
@Composable
fun EvTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String?,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    error: String? = null,
    hint: String? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLength: Int? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    prefix: String? = null,
    suffix: String? = null,
    leadingIcon: ImageVector? = null,
    trailing: (@Composable () -> Unit)? = null,
    enabled: Boolean = true,
    focusRequester: FocusRequester? = null,
) {
    val c = EvTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(EvRadius.md)
    val borderColor = when {
        error != null -> c.danger
        focused -> c.ink
        else -> c.hairline
    }
    Column(modifier) {
        if (label != null) {
            Text(label, style = EvTheme.type.label, color = c.inkSecondary, modifier = Modifier.padding(start = 4.dp, bottom = 6.dp))
        }
        BasicTextField(
            value = value,
            onValueChange = { v -> onValueChange(if (maxLength != null) v.take(maxLength) else v) },
            modifier = Modifier
                .fillMaxWidth()
                .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
                .semantics {
                    if (label != null) contentDescription = label
                    val errorText = error
                    if (errorText != null) this.error(errorText)
                },
            enabled = enabled,
            singleLine = singleLine,
            minLines = if (singleLine) 1 else minLines,
            textStyle = EvTheme.type.body.copy(color = if (enabled) c.ink else c.muted),
            cursorBrush = SolidColor(c.ink),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            visualTransformation = visualTransformation,
            interactionSource = interaction,
            decorationBox = { inner ->
                Row(
                    Modifier
                        .then(if (focused) Modifier.border(BorderStroke(4.dp, c.ink.copy(alpha = 0.12f)), RoundedCornerShape(EvRadius.md + 2.dp)) else Modifier)
                        .padding(if (focused) 2.dp else 0.dp)
                        .clip(shape)
                        .background(c.surfaceRaised)
                        .border(BorderStroke(if (focused || error != null) 1.5.dp else 1.dp, borderColor), shape)
                        .heightIn(min = 48.dp)
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (leadingIcon != null) Icon(leadingIcon, null, tint = c.muted, modifier = Modifier.size(18.dp))
                    if (prefix != null) Text(prefix, style = EvTheme.type.body, color = c.inkSecondary)
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty() && placeholder != null) {
                            Text(placeholder, style = EvTheme.type.body, color = c.muted, maxLines = if (singleLine) 1 else minLines, overflow = TextOverflow.Ellipsis)
                        }
                        inner()
                    }
                    if (suffix != null) Text(suffix, style = EvTheme.type.body, color = c.muted)
                    trailing?.invoke()
                }
            },
        )
        val below = error ?: hint
        if (below != null || maxLength != null && !singleLine) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 4.dp)) {
                Text(below ?: "", style = EvTheme.type.caption, color = if (error != null) c.danger else c.muted, modifier = Modifier.weight(1f))
                if (maxLength != null && !singleLine) Text("${value.length}/$maxLength", style = EvTheme.type.caption, color = c.muted)
            }
        }
    }
}

/** Password field with show/hide toggle; supports password managers (KeyboardType.Password). */
@Composable
fun PasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    visible: Boolean,
    onToggleVisible: () -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    imeAction: ImeAction = ImeAction.Done,
    onIme: () -> Unit = {},
) {
    EvTextField(
        value, onValueChange, label, modifier,
        error = error,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = imeAction),
        keyboardActions = KeyboardActions(onAny = { onIme() }),
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        leadingIcon = EvIcons.Lock,
        trailing = {
            IconCircleButton(
                EvIcons.Eye,
                contentDescription = label,
                onClick = onToggleVisible,
                style = CircleStyle.Transparent,
                size = 36.dp,
                iconSize = 18.dp,
                selected = visible,
            )
        },
    )
}

/** "50 123 45 67" mask for the 9 national digits after +994 (keeps the cursor where the user expects it). */
object LocalPhoneTransformation : VisualTransformation {
    private val breaks = intArrayOf(2, 5, 7)

    override fun filter(text: AnnotatedString): TransformedText {
        val digits = text.text
        val out = Phone.formatLocal(digits)
        val mapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int = (offset + breaks.count { it < offset }).coerceAtMost(out.length)
            override fun transformedToOriginal(offset: Int): Int {
                var spaces = 0
                var t = 0
                for (i in out.indices) {
                    if (i >= offset) break
                    if (out[i] == ' ') spaces++
                    t++
                }
                return (offset - spaces).coerceIn(0, digits.length)
            }
        }
        return TransformedText(AnnotatedString(out), mapping)
    }
}

/** +994 phone input (digits only, max 9, masked). [digits] are the national digits. */
@Composable
fun PhoneField(
    digits: String,
    onDigitsChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    imeAction: ImeAction = ImeAction.Done,
    onIme: () -> Unit = {},
    focusRequester: FocusRequester? = null,
) {
    EvTextField(
        value = digits,
        onValueChange = { onDigitsChange(it.filter(Char::isDigit).take(9)) },
        label = label,
        modifier = modifier,
        placeholder = "50 123 45 67",
        error = error,
        prefix = "+994",
        leadingIcon = EvIcons.Smartphone,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = imeAction),
        keyboardActions = KeyboardActions(onAny = { onIme() }),
        visualTransformation = LocalPhoneTransformation,
        focusRequester = focusRequester,
    )
}

/**
 * 6-digit OTP boxes over one hidden text field (paste + SMS autofill friendly). [onComplete] fires once all
 * digits are entered (auto-submit).
 */
@Composable
fun OtpField(
    code: String,
    onCodeChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    length: Int = 6,
    error: Boolean = false,
    focusRequester: FocusRequester? = null,
    onComplete: (String) -> Unit = {},
    contentDescription: String,
) {
    val c = EvTheme.colors
    BasicTextField(
        value = code,
        onValueChange = { v ->
            val d = v.filter(Char::isDigit).take(length)
            onCodeChange(d)
            if (d.length == length && d != code) onComplete(d)
        },
        modifier = modifier
            .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier)
            .semantics { this.contentDescription = contentDescription },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        singleLine = true,
        cursorBrush = SolidColor(Color.Transparent),
        decorationBox = { _ ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                repeat(length) { i ->
                    val ch = code.getOrNull(i)?.toString() ?: ""
                    val active = i == code.length.coerceAtMost(length - 1)
                    Box(
                        Modifier
                            .weight(1f)
                            .height(56.dp)
                            .clip(RoundedCornerShape(EvRadius.md))
                            .background(c.surfaceRaised)
                            .border(
                                BorderStroke(if (active || error) 1.5.dp else 1.dp, if (error) c.danger else if (active) c.ink else c.hairline),
                                RoundedCornerShape(EvRadius.md),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(ch, style = EvTheme.type.h2, textAlign = TextAlign.Center)
                    }
                }
            }
        },
    )
}

/** Search pill with leading magnifier (44 dp). */
@Composable
fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    onSubmit: () -> Unit = {},
    onCanvas: Boolean = true,
) {
    val c = EvTheme.colors
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.semantics { contentDescription = placeholder },
        singleLine = true,
        textStyle = EvTheme.type.body.copy(color = c.ink),
        cursorBrush = SolidColor(c.ink),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
        decorationBox = { inner ->
            Row(
                Modifier
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(50))
                    .background(if (onCanvas) c.surfaceRaised else c.surfaceSunken)
                    .padding(start = 16.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(EvIcons.Search, null, tint = c.inkSecondary, modifier = Modifier.size(20.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(placeholder, style = EvTheme.type.body, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    inner()
                }
                if (value.isNotEmpty()) {
                    IconCircleButton(EvIcons.Close, stringResource(R.string.common_clear), { onValueChange("") }, style = CircleStyle.Transparent, size = 36.dp, iconSize = 16.dp)
                }
            }
        },
    )
}

/** −/+ stepper (guests, rooms). */
@Composable
fun Stepper(value: Int, onChange: (Int) -> Unit, label: String, modifier: Modifier = Modifier, min: Int = 0, max: Int = 50, valueText: String = value.toString()) {
    val c = EvTheme.colors
    Row(modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = EvTheme.type.body, modifier = Modifier.weight(1f))
        IconCircleButton(EvIcons.Minus, "$label −", { onChange((value - 1).coerceAtLeast(min)) }, enabled = value > min, size = 40.dp)
        Text(
            valueText,
            style = EvTheme.type.bodyStrong,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(44.dp).semantics { stateDescription = valueText },
        )
        IconCircleButton(EvIcons.Plus, "$label +", { onChange((value + 1).coerceAtMost(max)) }, enabled = value < max, size = 40.dp)
    }
}

/** Custom switch (black track when on) — whole row toggles, exposed as a Switch to accessibility. */
@Composable
fun SwitchRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, hint: String? = null, enabled: Boolean = true) {
    val c = EvTheme.colors
    val thumb by animateDpAsState(if (checked) 22.dp else 2.dp, EvTheme.motion.fast(), label = "thumb")
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(label, style = EvTheme.type.body)
            if (hint != null) Text(hint, style = EvTheme.type.caption, color = c.muted)
        }
        Box(Modifier.width(48.dp).height(28.dp).clip(RoundedCornerShape(50)).background(if (checked) c.ink else c.pillHover)) {
            Box(
                Modifier
                    .offset(x = thumb, y = 2.dp)
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(if (checked) c.onInk else c.surfaceRaised),
            )
        }
    }
}

/** Checkbox row for multi-select lists (amenities, districts). */
@Composable
fun CheckRow(label: String, checked: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier, trailing: String? = null) {
    val c = EvTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = { onToggle() })
            .semantics { toggleableState = if (checked) ToggleableState.On else ToggleableState.Off }
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(24.dp).clip(RoundedCornerShape(7.dp)).background(if (checked) c.ink else c.surfaceRaised)
                .border(1.5.dp, if (checked) c.ink else c.subtle, RoundedCornerShape(7.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) Icon(EvIcons.Check, null, tint = c.onInk, modifier = Modifier.size(16.dp))
        }
        Text(label, style = EvTheme.type.body, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = EvTheme.type.caption, color = c.muted)
    }
}

/** Radio row for single choice in sheets. */
@Composable
fun RadioRow(label: String, selected: Boolean, onSelect: () -> Unit, modifier: Modifier = Modifier, hint: String? = null) {
    val c = EvTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .pressable(onSelect, role = Role.RadioButton)
            .semantics { this.selected = selected }
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = EvTheme.type.body)
            if (hint != null) Text(hint, style = EvTheme.type.caption, color = c.muted)
        }
        Box(
            Modifier.size(22.dp).clip(CircleShape).border(1.5.dp, if (selected) c.ink else c.subtle, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Box(Modifier.size(12.dp).clip(CircleShape).background(c.ink))
        }
    }
}

/** Segmented control: `pill` track, selected segment white with a soft shadow. */
@Composable
fun <T> Segmented(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    val c = EvTheme.colors
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(c.pill).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { (value, label) ->
            val isSel = value == selected
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = 40.dp)
                    .then(if (isSel) Modifier.softShadow(RoundedCornerShape(50), 4.dp) else Modifier)
                    .clip(RoundedCornerShape(50))
                    .background(if (isSel) c.surfaceRaised else Color.Transparent)
                    .pressable({ onSelect(value) }, role = Role.Tab)
                    .semantics { this.selected = isSel }
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = EvTheme.type.label, color = if (isSel) c.ink else c.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Read-only field that opens a picker sheet (city, district, metro, currency…). */
@Composable
fun SelectField(label: String, value: String?, placeholder: String, onClick: () -> Unit, modifier: Modifier = Modifier, error: String? = null, enabled: Boolean = true) {
    val c = EvTheme.colors
    Column(modifier) {
        Text(label, style = EvTheme.type.label, color = c.inkSecondary, modifier = Modifier.padding(start = 4.dp, bottom = 6.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clip(RoundedCornerShape(EvRadius.md))
                .background(c.surfaceRaised)
                .border(BorderStroke(1.dp, if (error != null) c.danger else c.hairline), RoundedCornerShape(EvRadius.md))
                .pressable(onClick, enabled = enabled, onClickLabel = label)
                .semantics {
                    contentDescription = label + ": " + (value ?: placeholder)
                    val errorText = error
                    if (errorText != null) this.error(errorText)
                }
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(value ?: placeholder, style = EvTheme.type.body, color = if (value == null) c.muted else c.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(EvIcons.ChevronDown, null, tint = c.inkSecondary, modifier = Modifier.size(18.dp))
        }
        if (error != null) Text(error, style = EvTheme.type.caption, color = c.danger, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
    }
}

/** Keeps a text selection at the end when the value is replaced programmatically. */
fun endSelection(text: String) = TextRange(text.length)
