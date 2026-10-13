package auth

import (
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// UserRow is a row of the users table.
type UserRow struct {
	ID              string
	Name            string
	Phone           *string
	Email           *string
	PasswordHash    *string
	AvatarURL       *string
	Role            string
	AccountType     string
	Status          string
	Locale          string
	IsPhoneVerified bool
	IsEmailVerified bool
	AgencyID        *string
	LastLoginAt     *time.Time
	CreatedAt       time.Time
}

// UserColumns lists users columns in ScanUser order; prefix with an alias when joining (e.g. "u."): use UserColumnsAs.
const UserColumns = `id, name, phone, email, password_hash, avatar_url, role, account_type, status, locale,
	is_phone_verified, is_email_verified, agency_id, last_login_at, created_at`

func ScanUser(row interface{ Scan(...any) error }) (*UserRow, error) {
	var u UserRow
	if err := row.Scan(&u.ID, &u.Name, &u.Phone, &u.Email, &u.PasswordHash, &u.AvatarURL, &u.Role, &u.AccountType, &u.Status, &u.Locale,
		&u.IsPhoneVerified, &u.IsEmailVerified, &u.AgencyID, &u.LastLoginAt, &u.CreatedAt); err != nil {
		return nil, err
	}
	return &u, nil
}

// UserDTO is the `User` DTO of @evtap/shared.
type UserDTO struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Phone           *string `json:"phone"`
	Email           *string `json:"email"`
	AvatarURL       *string `json:"avatarUrl"`
	Role            string  `json:"role"`
	AccountType     string  `json:"accountType"`
	Status          string  `json:"status"`
	Locale          string  `json:"locale"`
	IsPhoneVerified bool    `json:"isPhoneVerified"`
	IsEmailVerified bool    `json:"isEmailVerified"`
	AgencyID        *string `json:"agencyId"`
	CreatedAt       string  `json:"createdAt"`
}

func (u *UserRow) DTO() UserDTO {
	return UserDTO{ID: u.ID, Name: u.Name, Phone: u.Phone, Email: u.Email, AvatarURL: u.AvatarURL, Role: u.Role, AccountType: u.AccountType,
		Status: u.Status, Locale: u.Locale, IsPhoneVerified: u.IsPhoneVerified, IsEmailVerified: u.IsEmailVerified, AgencyID: u.AgencyID,
		CreatedAt: httpx.ISO(u.CreatedAt)}
}

func (u *UserRow) Principal() User {
	return User{ID: u.ID, Role: u.Role, AccountType: u.AccountType, AgencyID: u.AgencyID}
}
