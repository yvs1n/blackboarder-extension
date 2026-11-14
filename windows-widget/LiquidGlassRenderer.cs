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

    public static void DrawColorTag(Graphics g, Brush brush, float x, float y, float size = 9f, float radius = 2f)
    {
        var tagRect = new RectangleF(x, y, size, size);
        using var tagPath = GetRoundedRectanglePath(tagRect, radius);
        g.FillPath(brush, tagPath);
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

    public static Bitmap RenderWidget(
        string? wallpaperPath,
        List<TaskItem> tasks,
        List<CourseItem>? courses,
        AppConfig config,
        int screenWidth,
        int screenHeight,
        bool isOffline = false,
        StudentProfile? profile = null)
    {
        var bmp = new Bitmap(screenWidth, screenHeight, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;

        // 1. Draw base wallpaper image
        bool baseDrawn = false;
        if (!string.IsNullOrWhiteSpace(wallpaperPath) && File.Exists(wallpaperPath))
        {
            try
            {
                using var baseImg = Image.FromFile(wallpaperPath);
                float scale = Math.Max((float)screenWidth / baseImg.Width, (float)screenHeight / baseImg.Height);
                int drawW = (int)(baseImg.Width * scale);
                int drawH = (int)(baseImg.Height * scale);
                int drawX = (screenWidth - drawW) / 2;
                int drawY = (screenHeight - drawH) / 2;
                g.DrawImage(baseImg, drawX, drawY, drawW, drawH);
                baseDrawn = true;
            }
            catch { }
        }

        if (!baseDrawn)
        {
            g.Clear(Color.FromArgb(7, 10, 18)); // Deep obsidian matching mobile Scriptable widget
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

        string summaryText = GetPendingSummary(activePending);
        if (string.IsNullOrWhiteSpace(summaryText))
        {
            summaryText = "All Caught Up";
        }

        // 3. Layout geometry (matches Mobile Scriptable Frosted Row & Pill design)
        float scaleW = screenWidth / 1920f;
        float scaleH = screenHeight / 1080f;

        int widgetW = Math.Max(460, (int)(540 * scaleW));
        float widgetRadius = 22f * Math.Min(scaleW, scaleH);
        if (widgetRadius < 16f) widgetRadius = 16f;
        int padding = 18;
        int margin = (int)(45 * scaleH);
        int headerH = 34;
        int headerGap = 10;
        int rowH = 54;
        int rowGap = 6;
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

        var widgetRect = new RectangleF(widgetX, widgetY, widgetW, widgetH);

        // 4. Liquid Glass: Drop Shadow
        for (int i = 5; i >= 1; i--)
        {
            int shadowAlpha = (int)(14 / (float)i);
            var shadowRect = new RectangleF(
                widgetRect.X - i * 1.2f,
                widgetRect.Y + i * 1.8f,
                widgetRect.Width + i * 2.4f,
                widgetRect.Height + i * 2.0f
            );
            using var shadowPath = GetRoundedRectanglePath(shadowRect, widgetRadius + i);
            using var shadowBrush = new SolidBrush(Color.FromArgb(shadowAlpha, 0, 0, 0));
            g.FillPath(shadowBrush, shadowPath);
        }

        // 5. Liquid Glass: Optical Gaussian Blur + Obsidian Glass Tint
        int cropX = Math.Max(0, (int)widgetRect.X);
        int cropY = Math.Max(0, (int)widgetRect.Y);
        int cropW = Math.Min(bmp.Width - cropX, (int)widgetRect.Width);
        int cropH = Math.Min(bmp.Height - cropY, (int)widgetRect.Height);

        if (cropW > 0 && cropH > 0)
        {
            using var cropped = bmp.Clone(new Rectangle(cropX, cropY, cropW, cropH), PixelFormat.Format32bppArgb);
            FastBlurEngine.ApplyGaussian(cropped, Math.Max(4, config.BlurRadius));

            var state = g.Save();
            using var cardPath = GetRoundedRectanglePath(widgetRect, widgetRadius);
            g.SetClip(cardPath);
            g.DrawImage(cropped, widgetRect.X, widgetRect.Y, widgetRect.Width, widgetRect.Height);

            using (var glassWash = new LinearGradientBrush(
                widgetRect,
                Color.FromArgb(170, 15, 23, 42),
                Color.FromArgb(205, 7, 10, 18),
                LinearGradientMode.Vertical))
            {
                g.FillRectangle(glassWash, widgetRect);
            }

            using (var specularBrush = new LinearGradientBrush(
                widgetRect,
                Color.FromArgb(30, 255, 255, 255),
                Color.FromArgb(4, 255, 255, 255),
                LinearGradientMode.Vertical))
            {
                g.FillRectangle(specularBrush, widgetRect);
            }

            using (var borderPen = new Pen(Color.FromArgb(55, 255, 255, 255), 1.1f))
            {
                g.DrawPath(borderPen, cardPath);
            }

            g.Restore(state);
        }

        // 6. Typography Fonts & Brushes
        const string fontFamily = "Segoe UI";
        using var fontHeader = new Font(fontFamily, 9.5f, FontStyle.Bold);
        using var fontSummary = new Font(fontFamily, 8.5f, FontStyle.Bold);
        using var fontTaskTitle = new Font(fontFamily, 10.5f, FontStyle.Bold);
        using var fontCourseSub = new Font(fontFamily, 8.5f, FontStyle.Regular);
        using var fontDate = new Font(fontFamily, 9.5f, FontStyle.Bold);
        using var fontTime = new Font(fontFamily, 8.5f, FontStyle.Regular);

        using var headerBgBrush = new SolidBrush(Color.FromArgb(15, 255, 255, 255));
        using var headerBorderPen = new Pen(Color.FromArgb(31, 255, 255, 255), 1f);
        using var rowBgBrush = new SolidBrush(Color.FromArgb(12, 255, 255, 255));
        using var rowBorderPen = new Pen(Color.FromArgb(26, 255, 255, 255), 1f);
        using var pillBgBrush = new SolidBrush(Color.FromArgb(38, 56, 189, 248));
        using var pillBorderPen = new Pen(Color.FromArgb(90, 56, 189, 248), 1f);

        using var textHeaderBrush = new SolidBrush(Color.FromArgb(148, 163, 184));
        using var textPrimaryBrush = new SolidBrush(Color.FromArgb(248, 250, 252));
        using var textSecondaryBrush = new SolidBrush(Color.FromArgb(203, 213, 225));
        using var textDateBrush = new SolidBrush(Color.FromArgb(226, 232, 240));
        using var accentBrush = new SolidBrush(Color.FromArgb(56, 189, 248));

        // 7. Render Frosted Header Pill Container
        float innerX = widgetX + padding;
        float innerW = widgetW - (padding * 2);
        float curY = widgetY + padding;

        var headerRect = new RectangleF(innerX, curY, innerW, headerH);
        using (var headerPath = GetRoundedRectanglePath(headerRect, 9f))
        {
            g.FillPath(headerBgBrush, headerPath);
            g.DrawPath(headerBorderPen, headerPath);
        }

        string studentId = profile != null
            ? (!string.IsNullOrWhiteSpace(profile.StudentId) ? profile.StudentId : profile.Id)
            : string.Empty;
        string headerTitle = !string.IsNullOrWhiteSpace(studentId)
            ? $"Blackboarder {BulletChar} {studentId}"
            : (isOffline ? "Blackboarder (Offline)" : "Blackboarder");

        var headerTextSize = g.MeasureString(headerTitle, fontHeader);
        g.DrawString(headerTitle, fontHeader, textHeaderBrush, innerX + 10f, curY + (headerH - headerTextSize.Height) / 2f);

        // Sky-blue Summary Pill inside Header Right
        var summarySize = g.MeasureString(summaryText, fontSummary);
        float pillW = summarySize.Width + 14f;
        float pillH = 22f;
        float pillX = innerX + innerW - pillW - 7f;
        float pillY = curY + (headerH - pillH) / 2f;
        var pillRect = new RectangleF(pillX, pillY, pillW, pillH);
        using (var pillPath = GetRoundedRectanglePath(pillRect, 6f))
        {
            g.FillPath(pillBgBrush, pillPath);
            g.DrawPath(pillBorderPen, pillPath);
        }
        g.DrawString(summaryText, fontSummary, accentBrush, pillX + 7f, pillY + (pillH - summarySize.Height) / 2f);

        curY += headerH + headerGap;

        // 8. Render Frosted Task Rows with Vertical Course Color Accent Bar
        if (displayTasks.Count == 0)
        {
            var emptyRect = new RectangleF(innerX, curY, innerW, emptyH);
            using (var emptyPath = GetRoundedRectanglePath(emptyRect, 9f))
            {
                g.FillPath(headerBgBrush, emptyPath);
                g.DrawPath(headerBorderPen, emptyPath);
            }
            string emptyText = isOffline ? $"Offline {BulletChar} No cached deadlines" : "All caught up! No pending deadlines";
            var emptySize = g.MeasureString(emptyText, fontCourseSub);
            g.DrawString(emptyText, fontCourseSub, textSecondaryBrush, innerX + 12f, curY + (emptyH - emptySize.Height) / 2f);
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
                using (var rowPath = GetRoundedRectanglePath(rowRect, 9f))
                {
                    g.FillPath(rowBgBrush, rowPath);
                    g.DrawPath(rowBorderPen, rowPath);
                }

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
                    courseColor = Color.FromArgb(56, 189, 248);
                }

                // Vertical course color accent bar on the left edge inside the row
                float barX = innerX + 9f;
                float barH = 30f;
                float barY = curY + (rowH - barH) / 2f;
                var barRect = new RectangleF(barX, barY, 4f, barH);
                using (var barBrush = new SolidBrush(courseColor))
                using (var barPath = GetRoundedRectanglePath(barRect, 2f))
                {
                    g.FillPath(barBrush, barPath);
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

                g.DrawString(t.Title, fontTaskTitle, textPrimaryBrush, titleRect, strFormat);
                g.DrawString(dayStr, fontDate, textDateBrush, dateX, topY);
                g.DrawString(courseSubText, fontCourseSub, textSecondaryBrush, courseRect, strFormat);

                if (!string.IsNullOrWhiteSpace(timeStr))
                {
                    g.DrawString(timeStr, fontTime, accentBrush, rightPad - timeW, subY);
                }

                curY += rowH + rowGap;
            }
        }

        return bmp;
    }
}
