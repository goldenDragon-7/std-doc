package freeze

import (
	"archive/zip"
	"os"
	"path/filepath"
)

// writeZip emits a deflate zip of the given page names from frozenDir, each
// stored under arcname "<slug>/<name>" (mirrors freeze.py's arcname).
func writeZip(zipPath, frozenDir, slug string, names []string) error {
	f, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for _, n := range names {
		b, err := os.ReadFile(filepath.Join(frozenDir, n))
		if err != nil {
			zw.Close()
			return err
		}
		w, err := zw.CreateHeader(&zip.FileHeader{
			Name:   slug + "/" + n,
			Method: zip.Deflate,
		})
		if err != nil {
			zw.Close()
			return err
		}
		if _, err := w.Write(b); err != nil {
			zw.Close()
			return err
		}
	}
	return zw.Close()
}
