package httpx

import "net/http"

// Paginated is the list envelope of @evtap/shared: { items, total, page, pageSize }.
type Paginated[T any] struct {
	Items    []T `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

func NewPage[T any](items []T, total, page, pageSize int) Paginated[T] {
	if items == nil {
		items = []T{}
	}
	return Paginated[T]{Items: items, Total: total, Page: page, PageSize: pageSize}
}

type PageArgs struct{ Page, PageSize, Limit, Offset int }

// Pagination parses ?page&pageSize (defaults 1 / def, pageSize ≤ max), like paginationSchema.
func Pagination(r *http.Request, def, max int) (PageArgs, error) {
	q := Q(r)
	p, ps := 1, def
	if v := q.Int("page"); v != nil {
		p = *v
	}
	if v := q.Int("pageSize"); v != nil {
		ps = *v
	}
	if err := q.Err(); err != nil {
		return PageArgs{}, err
	}
	var errs []string
	if p < 1 {
		errs = append(errs, "page: Too small: expected >= 1")
	}
	if ps < 1 || ps > max {
		errs = append(errs, "pageSize: expected 1.."+itoa(max))
	}
	if errs != nil {
		return PageArgs{}, ValidationError(errs)
	}
	return PageArgs{Page: p, PageSize: ps, Limit: ps, Offset: (p - 1) * ps}, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}
