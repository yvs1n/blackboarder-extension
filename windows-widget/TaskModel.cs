using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace BlackboarderWidget;

public class TaskItem
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("courseCode")]
    public string CourseCode { get; set; } = string.Empty;

    [JsonPropertyName("courseName")]
    public string CourseName { get; set; } = string.Empty;

    [JsonPropertyName("courseColor")]
    public string CourseColor { get; set; } = string.Empty;

    [JsonPropertyName("dueDate")]
    public string DueDate { get; set; } = string.Empty;

    [JsonPropertyName("hasSpecificTime")]
    public bool? HasSpecificTime { get; set; }

    [JsonPropertyName("room")]
    public string Room { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("submissionStatus")]
    public string SubmissionStatus { get; set; } = string.Empty;

    [JsonPropertyName("score")]
    public double? Score { get; set; }

    [JsonPropertyName("isDone")]
    public bool IsDone { get; set; }

    [JsonPropertyName("completedAt")]
    public string CompletedAt { get; set; } = string.Empty;

    public bool IsCompleted()
    {
        if (IsDone) return true;
        if (!string.IsNullOrWhiteSpace(CompletedAt)) return true;
        if (string.Equals(Status, "completed", StringComparison.OrdinalIgnoreCase)) return true;
        if (string.Equals(Status, "done", StringComparison.OrdinalIgnoreCase)) return true;
        if (string.Equals(SubmissionStatus, "submitted", StringComparison.OrdinalIgnoreCase)) return true;
        if (string.Equals(SubmissionStatus, "graded", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public DateTime? GetDueDateTimeUtc()
    {
        if (string.IsNullOrWhiteSpace(DueDate)) return null;
        if (DateTime.TryParse(DueDate, out var dt))
        {
            return dt.ToUniversalTime();
        }
        return null;
    }

    public string GetFormattedDate()
    {
        if (string.IsNullOrWhiteSpace(DueDate)) return "TBD";
        if (DateTime.TryParse(DueDate, out var dt))
        {
            var local = dt.ToLocalTime();
            var today = DateTime.Today;
            if (local.Date == today) return "Today";
            if (local.Date == today.AddDays(1)) return "Tomorrow";
            return local.ToString("ddd, MMM d");
        }
        return "TBD";
    }

    public string GetFormattedTime()
    {
        if (HasSpecificTime != true || string.IsNullOrWhiteSpace(DueDate)) return string.Empty;
        if (DateTime.TryParse(DueDate, out var dt))
        {
            return dt.ToLocalTime().ToString("h:mm tt");
        }
        return string.Empty;
    }

    public string GetCleanCourseName()
    {
        string raw = !string.IsNullOrWhiteSpace(CourseName) ? CourseName :
                     !string.IsNullOrWhiteSpace(CourseCode) ? CourseCode : "Course";

        raw = Regex.Replace(raw, @"\s*\(\d+[\s\d]*\)", "").Trim();

        if (Regex.IsMatch(raw, @"calculus|calc\b", RegexOptions.IgnoreCase)) return "Calculus 1";
        if (Regex.IsMatch(raw, @"intro.*comp|computer.*eng", RegexOptions.IgnoreCase)) return "Intro to Comp";
        if (Regex.IsMatch(raw, @"phys.*lab", RegexOptions.IgnoreCase)) return "Physics 1 Lab";
        if (Regex.IsMatch(raw, @"phys", RegexOptions.IgnoreCase)) return "Physics 1";
        if (Regex.IsMatch(raw, @"english|eap", RegexOptions.IgnoreCase)) return "English";
        if (Regex.IsMatch(raw, @"islamic", RegexOptions.IgnoreCase)) return "Islamic";

        var parts = raw.Split(new[] { '-', '|' }, StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 0 ? parts[0].Trim() : raw;
    }

    public string GetCleanLocation()
    {
        string t = (Type ?? "").ToLowerInvariant();
        if (t == "assignment" || t == "hw" || t == "project") return string.Empty;

        string r = (Room ?? "").Trim();
        if (string.IsNullOrWhiteSpace(r)) return string.Empty;

        r = Regex.Replace(r, @"^(?:room|rm)\s+", "", RegexOptions.IgnoreCase);
        var split = Regex.Split(r, @"\s*[\(\[,\-]\s*(?:men|bldg|building|hall)", RegexOptions.IgnoreCase);
        return split.Length > 0 ? split[0].Trim() : r;
    }

    private static readonly (string Pattern, string Hex)[] DefaultColors = new[]
    {
        (@"(?:phys(?:ics)?.*lab|lab.*phys(?:ics)?|1430116|1430117|0401116)", "#4b99d2"),
        (@"(?:phys(?:ics)?|1430115|1430111|0401115)", "#4b99d2"),
        (@"(?:calculus|calc\b|1440133|1440131|0401101|0401201)", "#dc2626"),
        (@"(?:islamic|0104100|0104101)", "#489160"),
        (@"(?:intro.*comp|comp(?:uter)?\s*eng|1502101|0402101|0402102)", "#7c7c7c"),
        (@"(?:english|eap\b|0202112|0202111)", "#525252")
    };

    public string ResolveColor(IEnumerable<CourseItem>? customCourses = null)
    {
        if (!string.IsNullOrWhiteSpace(CourseColor)) return CourseColor;

        string combined = $"{CourseName} {CourseCode} {Title}".ToLowerInvariant();
        string cCode = (CourseCode ?? "").ToLowerInvariant().Trim();
        string cName = (CourseName ?? "").ToLowerInvariant().Trim();

        if (customCourses != null)
        {
            foreach (var c in customCourses)
            {
                if (string.IsNullOrWhiteSpace(c.ColorHex)) continue;
                string targetCode = (c.CourseCode ?? "").ToLowerInvariant().Trim();
                string targetName = (c.CourseName ?? "").ToLowerInvariant().Trim();

                if (!string.IsNullOrEmpty(targetCode) && (cCode == targetCode || combined.Contains(targetCode)))
                    return c.ColorHex;
                if (!string.IsNullOrEmpty(targetName) && (cName == targetName || combined.Contains(targetName)))
                    return c.ColorHex;
            }
        }

        foreach (var rule in DefaultColors)
        {
            if (Regex.IsMatch(combined, rule.Pattern, RegexOptions.IgnoreCase))
            {
                return rule.Hex;
            }
        }

        return "#38bdf8";
    }
}

public class CourseItem
{
    [JsonPropertyName("courseCode")]
    public string CourseCode { get; set; } = string.Empty;

    [JsonPropertyName("courseName")]
    public string CourseName { get; set; } = string.Empty;

    [JsonPropertyName("colorHex")]
    public string ColorHex { get; set; } = string.Empty;
}

public class TasksApiResponse
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("tasks")]
    public List<TaskItem> Tasks { get; set; } = new();

    [JsonPropertyName("courses")]
    public List<CourseItem> Courses { get; set; } = new();

    [JsonPropertyName("count")]
    public int Count { get; set; }

    [JsonPropertyName("syncKey")]
    public string SyncKey { get; set; } = string.Empty;

    [JsonPropertyName("profile")]
    public StudentProfile? Profile { get; set; }
}

public class StudentProfile
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("university")]
    public string University { get; set; } = string.Empty;

    [JsonPropertyName("studentId")]
    public string StudentId { get; set; } = string.Empty;

    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;
}
