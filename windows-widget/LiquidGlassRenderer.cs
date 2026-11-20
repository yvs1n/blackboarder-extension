using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

namespace BlackboarderWidget;

public static class LiquidGlassRenderer
{
    private const char BulletChar = '\u2022';
    private const char CheckChar = '\u2713';

    public static GraphicsPath GetRoundedRectanglePath(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        if (radius <= 0.5f)
        {
            path.AddRectangle(rect);
            return path;
        }
        float diameter = radius * 2;
        var size = new SizeF(diameter, diameter);
        var arc = new RectangleF(rect.Location, size);

        path.AddArc(arc, 180, 90);
        arc.X = rect.Right - diameter;
        path.AddArc(arc, 270, 90);
        arc.Y = rect.Bottom - diameter;
        path.AddArc(arc, 0, 90);
        arc.X = rect.Left;
        path.AddArc(arc, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static void FillBox(Graphics g, Brush brush, RectangleF rect, float radius)
    {
        if (radius <= 0.5f)
        {
            g.FillRectangle(brush, rect);
            return;
        }
        using var path = GetRoundedRectanglePath(rect, radius);
        g.FillPath(brush, path);
    }

    private static void DrawBox(Graphics g, Pen pen, RectangleF rect, float radius)
    {
        if (radius <= 0.5f)
        {
            g.DrawRectangle(pen, rect.X, rect.Y, rect.Width, rect.Height);
            return;
        }
        using var path = GetRoundedRectanglePath(rect, radius);
        g.DrawPath(pen, path);
    }

    public static void DrawColorTag(Graphics g, Brush brush, float x, float y, float size = 9f, float radius = 0f)
    {
        var tagRect = new RectangleF(x, y, size, size);
        FillBox(g, brush, tagRect, radius);
    }

    public static string GetPendingSummary(List<TaskItem> tasks)
    {
        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tasks)
        {
            if (t.IsCompleted() || string.Equals(t.Status, "dismissed", StringComparison.OrdinalIgnoreCase)) continue;
            string raw = !string.IsNullOrWhiteSpace(t.Type) ? t.Type.ToLowerInvariant().Trim() : "assignment";
            string type = (raw == "hw") ? "assignment" : raw;
            counts[type] = counts.TryGetValue(type, out int val) ? val + 1 : 1;
        }

        var parts = new List<string>();
        if (counts.TryGetValue("quiz", out int q) && q > 0)
            parts.Add($"{q} Quiz{(q > 1 ? "zes" : "")}");
        if (counts.TryGetValue("exam", out int e) && e > 0)
            parts.Add($"{e} Exam{(e > 1 ? "s" : "")}");
        if (counts.TryGetValue("assignment", out int a) && a > 0)
            parts.Add($"{a} HW");
        if (counts.TryGetValue("lab", out int l) && l > 0)
            parts.Add($"{l} Lab{(l > 1 ? "s" : "")}");
        if (counts.TryGetValue("project", out int p) && p > 0)
            parts.Add($"{p} Proj{(p > 1 ? "s" : "")}");
        if (counts.TryGetValue("other", out int o) && o > 0)
            parts.Add($"{o} Other");

        return string.Join($" {BulletChar} ", parts);
    }

    private static void DrawCrispString(Graphics g, string text, Font font, Brush foreground, Brush shadow, float x, float y)
    {
        g.DrawString(text, font, shadow, x + 0.9f, y + 1.1f);
        g.DrawString(text, font, foreground, x, y);
    }

    private static void DrawCrispString(Graphics g, string text, Font font, Brush foreground, Brush shadow, RectangleF rect, StringFormat format)
    {
        var shadowRect = new RectangleF(rect.X + 0.9f, rect.Y + 1.1f, rect.Width, rect.Height);
        g.DrawString(text, font, shadow, shadowRect, format);
        g.DrawString(text, font, foreground, rect, format);
    }

    private static Color ParseColor(string? hex, Color fallback)
    {
        if (string.IsNullOrWhiteSpace(hex)) return fallback;
        try
        {
            return ColorTranslator.FromHtml(hex.Trim());
        }
        catch
        {
            return fallback;
        }
    }

    private static int AlphaFromOpacity(double? opacity, int fallbackAlpha)
    {
        if (!opacity.HasValue || double.IsNaN(opacity.Value)) return fallbackAlpha;
        return Math.Clamp((int)Math.Round(opacity.Value * 255.0), 0, 255);
    }

    public static Bitmap RenderWidget(
        string? wallpaperPath,
        List<TaskItem> tasks,
        List<CourseItem>? courses,
        AppConfig config,
        int screenWidth,
        int screenHeight,
        bool isOffline = false,
        StudentProfile? profile = null,
        WidgetStyleConfig? styleConfig = null)
    {
        screenWidth = Math.Max(480, screenWidth);
        screenHeight = Math.Max(320, screenHeight);
        var theme = styleConfig?.Theme;

        var bmp = new Bitmap(screenWidth, screenHeight, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;

        // 1. Draw base wallpaper image (read bytes into memory so the file on disk is never locked)
        bool baseDrawn = false;
        if (!string.IsNullOrWhiteSpace(wallpaperPath) && File.Exists(wallpaperPath))
        {
            try
            {
                byte[] imgBytes = File.ReadAllBytes(wallpaperPath);
                using var ms = new MemoryStream(imgBytes, writable: false);
                using var baseImg = Image.FromStream(ms, useEmbeddedColorManagement: true, validateImageData: false);
                float scale = Math.Max((float)screenWidth / baseImg.Width, (float)screenHeight / baseImg.Height);
                int drawW = (int)(baseImg.Width * scale);
                int drawH = (int)(baseImg.Height * scale);
                int drawX = (screenWidth - drawW) / 2;
                int drawY = (screenHeight - drawH) / 2;
                g.DrawImage(baseImg, drawX, drawY, drawW, drawH);
                baseDrawn = true;
            }
            catch (Exception ex)
            {
                Program.Log($"Base wallpaper load warning ({wallpaperPath}): {ex.GetType().Name}: {ex.Message}");
            }
        }

        if (!baseDrawn)
        {
            g.Clear(ParseColor(theme?.BgMid, Color.Black)); // Pure neutral black matching mobile widget
        }

        // 2. Prepare tasks for display (exclude completed/done/submitted/graded tasks)
        var activePending = new List<TaskItem>();
        var nowUtc = DateTime.UtcNow;
        foreach (var t in tasks)
        {
            if (string.Equals(t.Status, "dismissed", StringComparison.OrdinalIgnoreCase)) continue;
            if (t.IsCompleted()) continue;
            var dueUtc = t.GetDueDateTimeUtc();
            if (dueUtc.HasValue && dueUtc.Value < nowUtc.AddHours(-1)) continue;
            activePending.Add(t);
        }

        activePending.Sort((x, y) =>
        {
            var dx = x.GetDueDateTimeUtc() ?? DateTime.MaxValue;
            var dy = y.GetDueDateTimeUtc() ?? DateTime.MaxValue;
            return dx.CompareTo(dy);
        });

        int limit = Math.Clamp(config.MaxTasks, 1, 9);
        var displayTasks = activePending.Count > limit ? activePending.GetRange(0, limit) : activePending;

        string caughtUpLabel = !string.IsNullOrWhiteSpace(styleConfig?.CaughtUpSummary)
            ? styleConfig.CaughtUpSummary
            : "All Caught Up";
        string summaryText = GetPendingSummary(activePending);
        if (string.IsNullOrWhiteSpace(summaryText))
        {
            summaryText = caughtUpLabel;
        }

        // 3. Layout geometry (Swiss Grid 0px square geometry + black frosted liquid glass)
        float scaleW = screenWidth / 1920f;
        float scaleH = screenHeight / 1080f;

        int widgetW = Math.Max(460, (int)(540 * scaleW));
        float widgetRadius = 0f; // Blackboarder Design System: 0px square corners everywhere
        int padding = Math.Clamp(theme?.Padding ?? 18, 10, 32);
        int margin = Math.Max(16, (int)(45 * scaleH));
        int headerH = Math.Clamp(theme?.HeaderHeight ?? 34, 24, 52);
        int headerGap = Math.Clamp(theme?.HeaderGap ?? 10, 4, 20);
        int rowH = Math.Clamp(theme?.RowHeight ?? 54, 40, 76);
        int rowGap = Math.Clamp(theme?.RowGap ?? 6, 2, 16);
        int emptyH = 52;
        int contentH = displayTasks.Count > 0
            ? (displayTasks.Count * rowH) + ((displayTasks.Count - 1) * rowGap)
            : emptyH;
        int widgetH = padding + headerH + headerGap + contentH + padding;

        int widgetX = config.Position switch
        {
            "TopLeft" => margin,
            "BottomLeft" => margin,
            "TopRight" => screenWidth - widgetW - margin,
            "BottomRight" => screenWidth - widgetW - margin,
            _ => (screenWidth - widgetW) / 2 // BottomCenter & TopCenter
        };

        int widgetY = config.Position switch
        {
            "TopCenter" => (int)(560 * scaleH),
            "TopLeft" => margin,
            "TopRight" => margin,
            _ => screenHeight - widgetH - margin // BottomCenter, BottomRight, BottomLeft
        };

        widgetX = Math.Clamp(widgetX, 0, Math.Max(0, screenWidth - widgetW));
        widgetY = Math.Clamp(widgetY, 0, Math.Max(0, screenHeight - widgetH));

        var widgetRect = new RectangleF(widgetX, widgetY, widgetW, widgetH);

        // 4. Liquid Glass: Crisp ambient separation shadow
        for (int i = 4; i >= 1; i--)
        {
            int shadowAlpha = (int)(12 / (float)i);
            var shadowRect = new RectangleF(
                widgetRect.X - i * 1.0f,
                widgetRect.Y + i * 1.4f,
                widgetRect.Width + i * 2.0f,
                widgetRect.Height + i * 1.6f
            );
            using var shadowBrush = new SolidBrush(Color.FromArgb(shadowAlpha, 0, 0, 0));
            FillBox(g, shadowBrush, shadowRect, widgetRadius);
        }

        // 5. Liquid Glass: Optical Gaussian Blur + Neutral Black Glass Tint + Hairline Refraction Rim
        int cropX = Math.Max(0, (int)widgetRect.X);
        int cropY = Math.Max(0, (int)widgetRect.Y);
        int cropW = Math.Min(bmp.Width - cropX, (int)widgetRect.Width);
        int cropH = Math.Min(bmp.Height - cropY, (int)widgetRect.Height);

        Color borderColorBase = Color.FromArgb(244, 244, 246); // #F4F4F6 Swiss Grid near-white
        Color accentBase = (styleConfig?.Version ?? 0) >= 4
            ? ParseColor(theme?.AccentColor, Color.FromArgb(244, 244, 246))
            : Color.FromArgb(244, 244, 246);
        Color bgTopBase = ParseColor(theme?.BgTop, Color.Black);
        Color bgMidBase = ParseColor(theme?.BgMid, Color.Black);

        float trans = Math.Clamp(config.GlassTransparency, 0, 100) / 100f;
        int washTopAlpha = Math.Clamp((int)Math.Round(220.0 * (1.0 - trans) + 6.0 * trans), 6, 235);
        int washBottomAlpha = Math.Clamp((int)Math.Round(242.0 * (1.0 - trans) + 16.0 * trans), 12, 248);

        if (cropW > 4 && cropH > 4)
        {
            using var cropped = bmp.Clone(new Rectangle(cropX, cropY, cropW, cropH), PixelFormat.Format32bppArgb);
            if (config.BlurRadius >= 1)
            {
                try
                {
                    FastBlurEngine.ApplyGaussian(cropped, config.BlurRadius);
                }
                catch (Exception ex)
                {
                    Program.Log($"Blur fallback warning: {ex.GetType().Name}: {ex.Message}");
                }
            }

            var state = g.Save();
            using var cardPath = GetRoundedRectanglePath(widgetRect, widgetRadius);
            g.SetClip(cardPath);
            g.DrawImage(cropped, widgetRect.X, widgetRect.Y, widgetRect.Width, widgetRect.Height);

            using (var glassWash = new LinearGradientBrush(
                widgetRect,
                Color.FromArgb(washTopAlpha, bgTopBase),
                Color.FromArgb(washBottomAlpha, bgMidBase),
                LinearGradientMode.Vertical))
            {
                g.FillRectangle(glassWash, widgetRect);
            }

            int specTopAlpha = Math.Clamp((int)Math.Round(18.0 + 26.0 * trans), 14, 52);
            int specBotAlpha = Math.Clamp((int)Math.Round(4.0 + 10.0 * trans), 4, 20);
            using (var specularBrush = new LinearGradientBrush(
                widgetRect,
                Color.FromArgb(specTopAlpha, borderColorBase),
                Color.FromArgb(specBotAlpha, borderColorBase),
                LinearGradientMode.Vertical))
            {
                g.FillRectangle(specularBrush, widgetRect);
            }

            // Inner 1px concentric refraction hairline
            var insetRect = new RectangleF(widgetRect.X + 1.5f, widgetRect.Y + 1.5f, widgetRect.Width - 3.0f, widgetRect.Height - 3.0f);
            using (var insetPen = new Pen(Color.FromArgb(Math.Clamp((int)Math.Round(18 + 20 * trans), 16, 44), borderColorBase), 1f))
            {
                DrawBox(g, insetPen, insetRect, widgetRadius);
            }

            // Outer 1px Swiss Grid specular border
            using (var rimBrush = new LinearGradientBrush(
                widgetRect,
                Color.FromArgb(Math.Clamp((int)Math.Round(68 + 62 * trans), 60, 145), borderColorBase),
                Color.FromArgb(Math.Clamp((int)Math.Round(28 + 34 * trans), 26, 72), borderColorBase),
                LinearGradientMode.ForwardDiagonal))
            using (var borderPen = new Pen(rimBrush, 1.25f))
            {
                DrawBox(g, borderPen, widgetRect, widgetRadius);
            }

            g.Restore(state);
        }

        // 6. Typography Fonts & Brushes (Swiss Grid Two-Tone)
        string fontFamily = ResolvePreferredFont("Inter", "Segoe UI");
        string displayFontFamily = ResolvePreferredFont("Inter Tight", fontFamily);
        using var fontHeader = new Font(displayFontFamily, 9.5f, FontStyle.Bold);
        using var fontSummary = new Font(fontFamily, 8.25f, FontStyle.Bold);
        using var fontTaskTitle = new Font(displayFontFamily, 10.5f, FontStyle.Bold);
        using var fontCourseSub = new Font(fontFamily, 8.5f, FontStyle.Regular);
        using var fontDate = new Font(fontFamily, 9.5f, FontStyle.Bold);
        using var fontTime = new Font(fontFamily, 8.5f, FontStyle.Regular);

        int surfaceDarkAlpha = Math.Clamp((int)Math.Round(48.0 * (1.0 - trans) + 20.0 * trans), 18, 64);
        int surfaceRimAlpha = Math.Clamp((int)Math.Round(28.0 + 20.0 * trans), 26, 54);
        using var headerBgBrush = new SolidBrush(Color.FromArgb(surfaceDarkAlpha + 6, 0, 0, 0));
        using var headerBorderPen = new Pen(Color.FromArgb(surfaceRimAlpha + 4, borderColorBase), 1f);
        using var rowBgBrush = new SolidBrush(Color.FromArgb(surfaceDarkAlpha, 0, 0, 0));
        using var rowBorderPen = new Pen(Color.FromArgb(surfaceRimAlpha, borderColorBase), 1f);
        using var pillBgBrush = new SolidBrush(Color.FromArgb(AlphaFromOpacity(theme?.PillBgOpacity, 36), accentBase));
        using var pillBorderPen = new Pen(Color.FromArgb(AlphaFromOpacity(theme?.PillBorderOpacity, 82), accentBase), 1f);

        using var textHeaderBrush = new SolidBrush(Color.FromArgb(161, 161, 170));   // #A1A1AA
        using var textPrimaryBrush = new SolidBrush(Color.FromArgb(244, 244, 246));  // #F4F4F6
        using var textSecondaryBrush = new SolidBrush(Color.FromArgb(161, 161, 170)); // #A1A1AA
        using var textDateBrush = new SolidBrush(Color.FromArgb(244, 244, 246));     // #F4F4F6
        using var textShadowBrush = new SolidBrush(Color.FromArgb(145, 0, 0, 0));
        using var accentBrush = new SolidBrush(accentBase);

        // 7. Render Square Header Strip Container
        float innerX = widgetX + padding;
        float innerW = widgetW - (padding * 2);
        float curY = widgetY + padding;
        float headerRadius = 0f;
        float rowRadius = 0f;

        var headerRect = new RectangleF(innerX, curY, innerW, headerH);
        FillBox(g, headerBgBrush, headerRect, headerRadius);
        DrawBox(g, headerBorderPen, headerRect, headerRadius);

        string brandName = !string.IsNullOrWhiteSpace(styleConfig?.BrandName) ? styleConfig.BrandName : "Blackboarder";
        string offlineLabel = !string.IsNullOrWhiteSpace(styleConfig?.OfflineLabel) ? styleConfig.OfflineLabel : "Offline";
        bool showStudentId = styleConfig?.ShowStudentId ?? true;
        string studentId = showStudentId && profile != null
            ? (!string.IsNullOrWhiteSpace(profile.StudentId) ? profile.StudentId : profile.Id)
            : string.Empty;
        string headerTitle = !string.IsNullOrWhiteSpace(studentId)
            ? $"{brandName.ToUpperInvariant()} {BulletChar} {studentId}"
            : (isOffline ? $"{brandName.ToUpperInvariant()} ({offlineLabel.ToUpperInvariant()})" : brandName.ToUpperInvariant());

        var headerTextSize = g.MeasureString(headerTitle, fontHeader);
        DrawCrispString(g, headerTitle, fontHeader, textHeaderBrush, textShadowBrush, innerX + 10f, curY + (headerH - headerTextSize.Height) / 2f);

        // Two-Tone Summary Badge inside Header Right (0px square)
        var summarySize = g.MeasureString(summaryText, fontSummary);
        float pillW = summarySize.Width + 14f;
        float pillH = 22f;
        float pillX = innerX + innerW - pillW - 7f;
        float pillY = curY + (headerH - pillH) / 2f;
        var pillRect = new RectangleF(pillX, pillY, pillW, pillH);
        FillBox(g, pillBgBrush, pillRect, 0f);
        DrawBox(g, pillBorderPen, pillRect, 0f);
        DrawCrispString(g, summaryText, fontSummary, accentBrush, textShadowBrush, pillX + 7f, pillY + (pillH - summarySize.Height) / 2f);

        curY += headerH + headerGap;

        // 8. Render Task Rows with 0px Vertical Course Color Accent Bar (the one color exception)
        if (displayTasks.Count == 0)
        {
            var emptyRect = new RectangleF(innerX, curY, innerW, emptyH);
            FillBox(g, headerBgBrush, emptyRect, rowRadius);
            DrawBox(g, headerBorderPen, emptyRect, rowRadius);
            string emptyText = isOffline
                ? (!string.IsNullOrWhiteSpace(styleConfig?.EmptyOfflineText) ? styleConfig.EmptyOfflineText : $"Offline {BulletChar} No cached deadlines")
                : (!string.IsNullOrWhiteSpace(styleConfig?.EmptyText) ? styleConfig.EmptyText : "All caught up! No pending deadlines");
            var emptySize = g.MeasureString(emptyText, fontCourseSub);
            DrawCrispString(g, emptyText, fontCourseSub, textSecondaryBrush, textShadowBrush, innerX + 12f, curY + (emptyH - emptySize.Height) / 2f);
        }
        else
        {
            using var strFormat = new StringFormat
            {
                Trimming = StringTrimming.EllipsisCharacter,
                FormatFlags = StringFormatFlags.NoWrap
            };

            foreach (var t in displayTasks)
            {
                var rowRect = new RectangleF(innerX, curY, innerW, rowH);
                FillBox(g, rowBgBrush, rowRect, rowRadius);
                DrawBox(g, rowBorderPen, rowRect, rowRadius);

                string courseColorHex = t.ResolveColor(courses);
                string courseName = t.GetCleanCourseName();
                string dayStr = t.GetFormattedDate();
                string timeStr = t.GetFormattedTime();
                string locStr = config.ShowLocation ? t.GetCleanLocation() : string.Empty;

                string courseSubText = !string.IsNullOrWhiteSpace(locStr)
                    ? $"{courseName}  {BulletChar}  {locStr}"
                    : courseName;

                Color courseColor;
                try
                {
                    courseColor = ColorTranslator.FromHtml(courseColorHex);
                }
                catch
                {
                    courseColor = Color.FromArgb(113, 113, 122); // #71717A neutral fallback
                }

                // Vertical course color accent bar on the left edge inside the row (0px square)
                float barX = innerX + 9f;
                float barH = 30f;
                float barY = curY + (rowH - barH) / 2f;
                var barRect = new RectangleF(barX, barY, 4f, barH);
                using (var barBrush = new SolidBrush(courseColor))
                {
                    FillBox(g, barBrush, barRect, 0f);
                }

                var dateSize = g.MeasureString(dayStr, fontDate);
                float rightPad = innerX + innerW - 10f;
                float dateX = rightPad - dateSize.Width;

                float textLeft = barX + 12f;
                float topY = curY + 8f;
                float subY = curY + 29f;

                float maxTitleW = Math.Max(100f, dateX - textLeft - 10f);
                var titleRect = new RectangleF(textLeft, topY, maxTitleW, 20f);

                float rightColW = dateSize.Width;
                float timeW = !string.IsNullOrWhiteSpace(timeStr) ? g.MeasureString(timeStr, fontTime).Width : 0f;
                rightColW = Math.Max(rightColW, timeW);
                float maxCourseW = Math.Max(100f, (rightPad - rightColW) - textLeft - 10f);
                var courseRect = new RectangleF(textLeft, subY, maxCourseW, 18f);

                DrawCrispString(g, t.Title, fontTaskTitle, textPrimaryBrush, textShadowBrush, titleRect, strFormat);
                DrawCrispString(g, dayStr, fontDate, textDateBrush, textShadowBrush, dateX, topY);
                DrawCrispString(g, courseSubText, fontCourseSub, textSecondaryBrush, textShadowBrush, courseRect, strFormat);

                if (!string.IsNullOrWhiteSpace(timeStr))
                {
                    DrawCrispString(g, timeStr, fontTime, textSecondaryBrush, textShadowBrush, rightPad - timeW, subY);
                }

                curY += rowH + rowGap;
            }
        }

        return bmp;
    }

    internal static string ResolvePreferredFont(string primary, string fallback)
    {
        try
        {
            using var installed = new InstalledFontCollection();
            foreach (var fam in installed.Families)
            {
                if (string.Equals(fam.Name, primary, StringComparison.OrdinalIgnoreCase) &&
                    fam.IsStyleAvailable(FontStyle.Regular) &&
                    fam.IsStyleAvailable(FontStyle.Bold))
                {
                    return fam.Name;
                }
            }
        }
        catch { }
        return fallback;
    }
}
