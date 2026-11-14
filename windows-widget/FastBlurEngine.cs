using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace BlackboarderWidget;

public static class FastBlurEngine
{
    public static void ApplyGaussian(Bitmap bmp, int radius)
    {
        if (radius < 1) return;

        int w = bmp.Width;
        int h = bmp.Height;

        BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int bytes = data.Stride * h;
        byte[] rgb = new byte[bytes];
        byte[] temp = new byte[bytes];
        Marshal.Copy(data.Scan0, rgb, 0, bytes);

        int[] boxes = BoxesForGauss(radius, 3);
        BoxBlur(rgb, temp, w, h, data.Stride, (boxes[0] - 1) / 2);
        BoxBlur(rgb, temp, w, h, data.Stride, (boxes[1] - 1) / 2);
        BoxBlur(rgb, temp, w, h, data.Stride, (boxes[2] - 1) / 2);

        Marshal.Copy(rgb, 0, data.Scan0, bytes);
        bmp.UnlockBits(data);
    }

    private static int[] BoxesForGauss(float sigma, int n)
    {
        float wIdeal = (float)Math.Sqrt((12 * sigma * sigma / n) + 1);
        int wl = (int)Math.Floor(wIdeal);
        if (wl % 2 == 0) wl--;
        int wu = wl + 2;
        float mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
        int m = (int)Math.Round(mIdeal);
        int[] sizes = new int[n];
        for (int i = 0; i < n; i++) sizes[i] = (i < m ? wl : wu);
        return sizes;
    }

    private static void BoxBlur(byte[] scl, byte[] tcl, int w, int h, int stride, int r)
    {
        if (r < 1) return;
        BoxBlurH(scl, tcl, w, h, stride, r);
        BoxBlurT(tcl, scl, w, h, stride, r);
    }

    private static void BoxBlurH(byte[] scl, byte[] tcl, int w, int h, int stride, int r)
    {
        float iarr = 1f / (r + r + 1);
        Parallel.For(0, h, i =>
        {
            int ti = i * stride;
            int li = ti;
            int ri = ti + r * 4;

            int fv_b = scl[ti];
            int fv_g = scl[ti + 1];
            int fv_r = scl[ti + 2];
            int fv_a = scl[ti + 3];

            int lv_b = scl[ti + (w - 1) * 4];
            int lv_g = scl[ti + (w - 1) * 4 + 1];
            int lv_r = scl[ti + (w - 1) * 4 + 2];
            int lv_a = scl[ti + (w - 1) * 4 + 3];

            int val_b = (r + 1) * fv_b;
            int val_g = (r + 1) * fv_g;
            int val_r = (r + 1) * fv_r;
            int val_a = (r + 1) * fv_a;

            for (int j = 0; j < r; j++)
            {
                val_b += scl[ti + j * 4];
                val_g += scl[ti + j * 4 + 1];
                val_r += scl[ti + j * 4 + 2];
                val_a += scl[ti + j * 4 + 3];
            }

            for (int j = 0; j <= r; j++)
            {
                val_b += scl[ri] - fv_b;
                val_g += scl[ri + 1] - fv_g;
                val_r += scl[ri + 2] - fv_r;
                val_a += scl[ri + 3] - fv_a;
                ri += 4;
                tcl[ti] = (byte)(val_b * iarr);
                tcl[ti + 1] = (byte)(val_g * iarr);
                tcl[ti + 2] = (byte)(val_r * iarr);
                tcl[ti + 3] = (byte)(val_a * iarr);
                ti += 4;
            }

            for (int j = r + 1; j < w - r; j++)
            {
                val_b += scl[ri] - scl[li];
                val_g += scl[ri + 1] - scl[li + 1];
                val_r += scl[ri + 2] - scl[li + 2];
                val_a += scl[ri + 3] - scl[li + 3];
                ri += 4; li += 4;
                tcl[ti] = (byte)(val_b * iarr);
                tcl[ti + 1] = (byte)(val_g * iarr);
                tcl[ti + 2] = (byte)(val_r * iarr);
                tcl[ti + 3] = (byte)(val_a * iarr);
                ti += 4;
            }

            for (int j = w - r; j < w; j++)
            {
                val_b += lv_b - scl[li];
                val_g += lv_g - scl[li + 1];
                val_r += lv_r - scl[li + 2];
                val_a += lv_a - scl[li + 3];
                li += 4;
                tcl[ti] = (byte)(val_b * iarr);
                tcl[ti + 1] = (byte)(val_g * iarr);
                tcl[ti + 2] = (byte)(val_r * iarr);
                tcl[ti + 3] = (byte)(val_a * iarr);
                ti += 4;
            }
        });
    }

    private static void BoxBlurT(byte[] scl, byte[] tcl, int w, int h, int stride, int r)
    {
        float iarr = 1f / (r + r + 1);
        Parallel.For(0, w, i =>
        {
            int ti = i * 4;
            int li = ti;
            int ri = ti + r * stride;

            int fv_b = scl[ti];
            int fv_g = scl[ti + 1];
            int fv_r = scl[ti + 2];
            int fv_a = scl[ti + 3];

            int lv_b = scl[ti + (h - 1) * stride];
            int lv_g = scl[ti + (h - 1) * stride + 1];
            int lv_r = scl[ti + (h - 1) * stride + 2];
            int lv_a = scl[ti + (h - 1) * stride + 3];

            int val_b = (r + 1) * fv_b;
            int val_g = (r + 1) * fv_g;
            int val_r = (r + 1) * fv_r;
            int val_a = (r + 1) * fv_a;

            for (int j = 0; j < r; j++)
            {
                val_b += scl[ti + j * stride];
                val_g += scl[ti + j * stride + 1];
                val_r += scl[ti + j * stride + 2];
                val_a += scl[ti + j * stride + 3];
            }

            for (int j = 0; j <= r; j++)
            {
                val_b += scl[ri] - fv_b;
                val_g += scl[ri + 1] - fv_g;
                val_r += scl[ri + 2] - fv_r;
                val_a += scl[ri + 3] - fv_a;
                ri += stride;
                tcl[ti] = (byte)(val_b * iarr);
                tcl[ti + 1] = (byte)(val_g * iarr);
                tcl[ti + 2] = (byte)(val_r * iarr);
                tcl[ti + 3] = (byte)(val_a * iarr);
                ti += stride;
            }

            for (int j = r + 1; j < h - r; j++)
            {
                val_b += scl[ri] - scl[li];
                val_g += scl[ri + 1] - scl[li + 1];
                val_r += scl[ri + 2] - scl[li + 2];
                val_a += scl[ri + 3] - scl[li + 3];
                ri += stride; li += stride;
                tcl[ti] = (byte)(val_b * iarr);
                tcl[ti + 1] = (byte)(val_g * iarr);
                tcl[ti + 2] = (byte)(val_r * iarr);
                tcl[ti + 3] = (byte)(val_a * iarr);
                ti += stride;
            }

            for (int j = h - r; j < h; j++)
            {
                val_b += lv_b - scl[li];
                val_g += lv_g - scl[li + 1];
                val_r += lv_r - scl[li + 2];
                val_a += lv_a - scl[li + 3];
                li += stride;
                tcl[ti] = (byte)(val_b * iarr);
                tcl[ti + 1] = (byte)(val_g * iarr);
                tcl[ti + 2] = (byte)(val_r * iarr);
                tcl[ti + 3] = (byte)(val_a * iarr);
                ti += stride;
            }
        });
    }
}
