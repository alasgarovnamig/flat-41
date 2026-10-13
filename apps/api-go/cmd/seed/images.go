package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"strconv"

	"github.com/disintegration/imaging"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

const imgW, imgH = 1600, 1200

func hexColor(s string) color.RGBA {
	v, _ := strconv.ParseUint(s[1:], 16, 32)
	return color.RGBA{R: uint8(v >> 16), G: uint8(v >> 8), B: uint8(v), A: 255}
}

func lerp(a, b uint8, t float64) uint8 { return uint8(float64(a) + (float64(b)-float64(a))*t + 0.5) }

// house outline (SVG path "M240 0 L480 200 L420 200 L420 440 L60 440 L60 200 L0 200 Z")
var housePoly = [][2]float64{{240, 0}, {480, 200}, {420, 200}, {420, 440}, {60, 440}, {60, 200}, {0, 200}}

func inPoly(x, y float64, poly [][2]float64) bool {
	in := false
	for i, j := 0, len(poly)-1; i < len(poly); j, i = i, i+1 {
		xi, yi, xj, yj := poly[i][0], poly[i][1], poly[j][0], poly[j][1]
		if (yi > y) != (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi {
			in = !in
		}
	}
	return in
}

// placeholder draws the TS seed's SVG: diagonal gradient, a white house with a door, "EvTap · kind" caption.
func placeholder(kind string, i int) *image.RGBA {
	pal := palette[kind]
	bg, fg := hexColor(pal[0]), hexColor(pal[1])
	img := image.NewRGBA(image.Rect(0, 0, imgW, imgH))
	for y := 0; y < imgH; y++ {
		for x := 0; x < imgW; x++ {
			t := (float64(x)/imgW + float64(y)/imgH) / 2
			img.SetRGBA(x, y, color.RGBA{R: lerp(bg.R, fg.R, t), G: lerp(bg.G, fg.G, t), B: lerp(bg.B, fg.B, t), A: 255})
		}
	}
	ox, oy := 560+(i%3)*20, 330+(i%2)*20
	for y := 0; y <= 440; y++ {
		for x := 0; x <= 480; x++ {
			px, py := ox+x, oy+y
			if x >= 200 && x < 280 && y >= 290 && y < 440 { // door
				img.SetRGBA(px, py, fg)
				continue
			}
			if inPoly(float64(x)+0.5, float64(y)+0.5, housePoly) {
				c := img.RGBAAt(px, py)
				img.SetRGBA(px, py, color.RGBA{R: lerp(c.R, 255, 0.85), G: lerp(c.G, 255, 0.85), B: lerp(c.B, 255, 0.85), A: 255})
			}
		}
	}
	drawCaption(img, "EvTap - "+kind, 980)
	return img
}

// drawCaption renders text with the 7x13 bitmap font scaled ×5, centred horizontally, baseline at y.
func drawCaption(dst *image.RGBA, text string, baseline int) {
	face := basicfont.Face7x13
	w := font.MeasureString(face, text).Ceil()
	small := image.NewAlpha(image.Rect(0, 0, w, 13))
	d := &font.Drawer{Dst: small, Src: image.Opaque, Face: face, Dot: fixed.P(0, 11)}
	d.DrawString(text)
	const scale = 5
	x0 := (dst.Bounds().Dx() - w*scale) / 2
	y0 := baseline - 11*scale
	for y := 0; y < 13; y++ {
		for x := 0; x < w; x++ {
			if small.AlphaAt(x, y).A < 128 {
				continue
			}
			for dy := 0; dy < scale; dy++ {
				for dx := 0; dx < scale; dx++ {
					px, py := x0+x*scale+dx, y0+y*scale+dy
					c := dst.RGBAAt(px, py)
					dst.SetRGBA(px, py, color.RGBA{R: lerp(c.R, 255, 0.9), G: lerp(c.G, 255, 0.9), B: lerp(c.B, 255, 0.9), A: 255})
				}
			}
		}
	}
}

// generateLocalImages writes UPLOAD_DIR/seed/<id>.jpg (1600×1200) and <id>_t.jpg (400 px wide) for every demo photo.
func generateLocalImages(uploadDir string) error {
	dir := filepath.Join(uploadDir, "seed")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, kind := range photoKinds {
		for i, id := range photos[kind] {
			img := placeholder(kind, i)
			if err := writeJPEG(filepath.Join(dir, id+".jpg"), img, 82); err != nil {
				return err
			}
			if err := writeJPEG(filepath.Join(dir, id+"_t.jpg"), imaging.Resize(img, 400, 0, imaging.Lanczos), 75); err != nil {
				return err
			}
		}
	}
	return nil
}

func writeJPEG(path string, img image.Image, q int) error {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: q}); err != nil {
		return fmt.Errorf("encode %s: %w", path, err)
	}
	return os.WriteFile(path, buf.Bytes(), 0o644)
}
